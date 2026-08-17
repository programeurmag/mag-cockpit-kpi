#!/usr/bin/env python3
"""
MAG · Cockpit KPI — builder.
Pull GHL (ventes) + Jobber (soumissions, lecture seule) + Meta (CAC/CPL/FB Ads),
écrit docs/data/kpis.json et docs/data/history.json.

Phase actuelle (voir CLAUDE.md) : VENTES + CAC + section FB ADS.
La section Rentabilité (main-d'œuvre / Jobber timesheets) reste PARQUÉE sur des
données démo — pas branchée cette phase-ci, voir RENT_PARKED plus bas.

Toutes les valeurs numériques ici sont dérivées d'appels GET/GraphQL en lecture
seule. Ce script n'écrit JAMAIS dans GHL, Jobber ou Meta — aucune mutation de
campagne, ad set ou budget. La section FB Ads ne fait que des suggestions
(texte), jamais d'action automatique sur le compte.
"""
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta, date, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Montreal")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "docs", "data")
HISTORY_PATH = os.path.join(DATA_DIR, "history.json")
KPIS_PATH = os.path.join(DATA_DIR, "kpis.json")


def load_env():
    """Charge .env local si présent (dev). En prod (GitHub Actions), les
    variables viennent déjà de l'environnement (GitHub Secrets) — os.environ
    a priorité, on ne l'écrase jamais avec le .env local."""
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k, v)


load_env()

GHL_TOKEN = os.environ.get("GHL_TOKEN", "")
GHL_LOCATION_ID = os.environ.get("GHL_LOCATION_ID", "")
JOBBER_CLIENT_ID = os.environ.get("JOBBER_CLIENT_ID", "")
JOBBER_CLIENT_SECRET = os.environ.get("JOBBER_CLIENT_SECRET", "")
JOBBER_REFRESH_TOKEN = os.environ.get("JOBBER_REFRESH_TOKEN", "")
META_TOKEN = os.environ.get("META_TOKEN", "")
META_AD_ACCOUNT = os.environ.get("META_AD_ACCOUNT", "")
LOADED_RATE = float(os.environ.get("LOADED_RATE", "28.32"))

# =============================================================================
# CONSTANTES — validées le 2026-08-17 par appel direct aux API (voir chat).
# =============================================================================

GHL_API = "https://services.leadconnectorhq.com"
GHL_VERSION = "2021-07-28"

GHL_PIPELINES = {
    "setting": "Q8EYGzimcGKdgZeTbu7D",  # SETTING : Nouveau lead -> ... -> RDV BOOKÉ
    "closing": "DRsf93wLTlsI55zjmywa",  # CLOSING : RDV À VENIR -> SUIVI À FAIRE -> EN ATTENTE DE DÉPÔT
}

# IMPORTANT : GHL n'a PAS de stage "Won"/"Lost" dédié dans ces pipelines.
# Le won/lost vit sur le champ natif `status` de l'opportunité (open/won/lost/
# abandoned), indépendant du stage. On filtre là-dessus, jamais par stage id.
GHL_WON_STATUS = "won"
GHL_LOST_STATUS = "lost"

# Justin a restructuré sa pipeline GHL il y a ~2 semaines (vers le 2026-08-03).
# Les données d'avant cette date mélangent ancienne/nouvelle structure — on ne
# les utilise pas cette phase-ci (voir chat, décision du 2026-08-17).
PIPELINE_CUTOVER = datetime(2026, 8, 3, tzinfo=TZ)

# Calendriers GHL (un par vendeur/membre d'équipe) utilisés pour RDV/visites.
GHL_CALENDAR_IDS = [
    "I5UqN68X2AknRGf8eBQV",  # jeremy dagenais
    "Kqi3zvpFt1azFeSVlxr7",  # Justin Blaquiere (1)
    "cCyMNwZlmoWMHuMwqnY9",  # Tamassyn Seck
    "cc4Ty4RM5bB0t2Ivet4Y",  # Justin Boivin
    "iGoXOtjDEJHyiz6vT5eI",  # Charly Pearson
    "jkhPqmPGy2iiY03XoDCB",  # Justin Blaquiere (2)
    "pGNB0a4wrarcYc6i58IO",  # Mathias Grandmont
]

JOBBER_API = "https://api.getjobber.com/api/graphql"
JOBBER_OAUTH_TOKEN_URL = "https://api.getjobber.com/api/oauth/token"
JOBBER_API_VERSION = "2026-07-27"

# Meta — validé le 2026-08-17 : action_type "lead" == "onsite_conversion.lead_grouped"
# == "offsite_complete_registration_add_meta_leads" (même 66 leads, juste des vues
# différentes du même événement). On garde le plus standard.
META_API_VERSION = "v21.0"
META_LEAD_ACTION_TYPES = ["lead"]

# Structure de compte réelle (validée par API, 2026-08-17) : les AD SETS sont
# groupés par FORMAT ("NEW CONTENT", "Images statics AI"...), pas par angle —
# contrairement à la description initiale ("un ad set par angle"). L'ANGLE
# créatif vit dans le nom de la PUB (ad), en texte libre. Donc :
#   - COUPER / SCALER (budget)      -> niveau AD SET
#   - FATIGUE / ANGLE / DIVERSITÉ   -> niveau AD (créa)
# Le classement par angle est du best-effort par mot-clé sur ad_name — chaque
# reco cite le nom exact de la pub, jamais un chiffre sans preuve.
ANGLE_KEYWORDS = [
    ("sable", ["sable"]),
    ("mauvaises herbes", ["mauvaises herbes", "herbes"]),
    ("comparaison / avant-après", ["avant apres", "avant/apres", "avant après", "vs nous", "eux vs", "lequel a"]),
]

FBADS_CPL_CUT = 25          # au-dessus -> candidat COUPER
FBADS_CPL_SCALE = 17        # en dessous -> candidat SCALER (borne basse de la cible 17-21$)
FBADS_MIN_SPEND_SIGNIFICANT = 100   # $ dépensés min avant de juger un ad set/ad
FBADS_MIN_LEADS_SIGNIFICANT = 5     # OU ce nombre de leads min
FBADS_FREQ_FATIGUE = 2.5            # fréquence au-dessus de ça = zone de fatigue
FBADS_DIVERSITY_SHARE = 0.5         # une créa qui porte >= 50% de la dépense = flag

# Cibles — DOIT rester synchro avec CLOSE_FLOOR/CLOSE_CEIL et targetLabel dans
# docs/cockpit-kpi-mag.jsx (une seule source de vérité, voir CLAUDE.md).
TARGETS = {
    "contact": {"target": 80, "dir": "up", "label": "≥ 80 %"},
    "rdv": {"target": 60, "dir": "up", "label": "≥ 60 %"},
    "close": {"target": 35, "dir": "up", "label": "35–45 %"},  # plancher 35, plafond 45 (voir CLOSE_CEIL côté .jsx)
    "deal": {"target": 2400, "dir": "up", "label": "≥ 2 400 $"},
    "cpl": {"target": 21, "dir": "down", "label": "17–21 $"},
    "cac": {"target": 350, "dir": "down", "label": "≤ 350 $"},
}
CLOSE_FLOOR = 35
CLOSE_CEIL = 45

# Section Rentabilité — PARQUÉE cette phase-ci (main-d'œuvre / Jobber timesheets
# se fait séparément au bureau). Valeurs statiques copiées de la démo, pas
# recalculées. Ne pas brancher tant que le module rentabilité n'est pas prêt.
RENT_PARKED = [
    {"k": "labor", "label": "Main-d'œuvre / CA", "v": 46, "disp": "46 %", "target": 35, "dir": "down", "targetLabel": "30–35 %", "streak": 6, "sub": "parqué — voir module rentabilité"},
    {"k": "rework", "label": "Taux de reprise", "v": 6.8, "disp": "6,8 %", "target": 4, "dir": "down", "targetLabel": "≤ 4 %", "streak": 4, "sub": "parqué"},
    {"k": "marge", "label": "Marge brute", "v": 34, "disp": "34 %", "target": 40, "dir": "up", "targetLabel": "≥ 40 %", "streak": 3, "sub": "parqué"},
    {"k": "rpp", "label": "Revenu / personne / jour", "v": 1180, "disp": "1 180 $", "target": 1400, "dir": "up", "targetLabel": "≥ 1 400 $", "streak": 3, "sub": "parqué"},
]


# =============================================================================
# HTTP helpers
# =============================================================================

def http_get_json(url, params=None, headers=None):
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    req = urllib.request.Request(url + qs, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def http_post_json(url, payload, headers=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"User-Agent": UA, "Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def ghl_headers():
    return {
        "Authorization": f"Bearer {GHL_TOKEN}",
        "Version": GHL_VERSION,
        "Accept": "application/json",
    }


def ghl_search_opportunities(pipeline_id, extra_params=None, page_limit=100):
    """Pagine /opportunities/search. Lecture seule."""
    out = []
    params = {"location_id": GHL_LOCATION_ID, "pipeline_id": pipeline_id, "limit": page_limit}
    if extra_params:
        params.update(extra_params)
    while True:
        res = http_get_json(f"{GHL_API}/opportunities/search", params, ghl_headers())
        opps = res.get("opportunities", [])
        out.extend(opps)
        meta = res.get("meta", {})
        next_after = meta.get("startAfter")
        next_after_id = meta.get("startAfterId")
        if not opps or not meta.get("nextPage") or len(opps) < page_limit:
            break
        params["startAfter"] = next_after
        params["startAfterId"] = next_after_id
    return out


def ghl_calendar_events(calendar_id, start_ms, end_ms):
    res = http_get_json(
        f"{GHL_API}/calendars/events",
        {"locationId": GHL_LOCATION_ID, "calendarId": calendar_id, "startTime": start_ms, "endTime": end_ms},
        ghl_headers(),
    )
    return res.get("events", [])


def jobber_access_token():
    """ATTENTION : si Jobber fait un jour tourner (rotate) le refresh token,
    ce script écrit le nouveau en LOCAL (.env) mais ne peut pas mettre à jour
    le secret GitHub Actions automatiquement. Si le cron GitHub commence à
    échouer sur l'auth Jobber, va chercher un refresh token frais (voir
    mag-rentabilite ou re-fait le flow OAuth) et remplace le secret
    JOBBER_REFRESH_TOKEN dans GitHub → Settings → Secrets."""
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": JOBBER_CLIENT_ID,
        "client_secret": JOBBER_CLIENT_SECRET,
        "refresh_token": JOBBER_REFRESH_TOKEN,
    }).encode()
    req = urllib.request.Request(
        JOBBER_OAUTH_TOKEN_URL, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read().decode())
    return body["access_token"]


def jobber_recent_quotes(access_token, since_dt, max_pages=10):
    """Lecture seule. Pagine les quotes triées par createdAt desc, s'arrête
    dès qu'on dépasse `since_dt` (les quotes plus vieilles n'intéressent pas
    cette fenêtre)."""
    out = []
    cursor = None
    for _ in range(max_pages):
        after_clause = f', after: "{cursor}"' if cursor else ""
        query = f"""
        query {{
          quotes(first: 50, sort: {{ key: CREATED_AT, direction: DESCENDING }}{after_clause}) {{
            nodes {{
              quoteNumber
              quoteStatus
              createdAt
              sentAt
              client {{ name emails {{ address }} phones {{ number }} }}
              amounts {{ total }}
            }}
            pageInfo {{ hasNextPage endCursor }}
          }}
        }}
        """
        res = http_post_json(JOBBER_API, {"query": query}, {
            "Authorization": f"Bearer {access_token}",
            "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
        })
        if "errors" in res:
            raise RuntimeError(f"Jobber GraphQL error: {res['errors']}")
        block = res["data"]["quotes"]
        nodes = block["nodes"]
        out.extend(nodes)
        oldest = nodes[-1]["createdAt"] if nodes else None
        if not block["pageInfo"]["hasNextPage"] or (oldest and datetime.fromisoformat(oldest.replace("Z", "+00:00")) < since_dt):
            break
        cursor = block["pageInfo"]["endCursor"]
    return out


def meta_get(path, params):
    return http_get_json(f"https://graph.facebook.com/{META_API_VERSION}/{path}",
                          {**params, "access_token": META_TOKEN})


def meta_insights(level, since, until):
    """Lecture seule. `since`/`until` sont des date() (bornes incluses)."""
    base_fields = "spend,impressions,reach,frequency,ctr,cpm,clicks,actions"
    if level == "adset":
        fields = "adset_id,adset_name,campaign_name," + base_fields
    elif level == "ad":
        fields = "ad_id,ad_name,adset_id,adset_name,campaign_name," + base_fields
    else:
        fields = base_fields
    params = {
        "level": level,
        "fields": fields,
        "time_range": json.dumps({"since": since.isoformat(), "until": until.isoformat()}),
        "limit": 200,
    }
    out = []
    res = meta_get(f"{META_AD_ACCOUNT}/insights", params)
    out.extend(res.get("data", []))
    # pagination (compte petit pour l'instant, mais on ne suppose rien)
    next_url = res.get("paging", {}).get("next")
    while next_url:
        req = urllib.request.Request(next_url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read().decode())
        out.extend(res.get("data", []))
        next_url = res.get("paging", {}).get("next")
    return out


def meta_leads_count(row):
    for a in row.get("actions", []):
        if a.get("action_type") in META_LEAD_ACTION_TYPES:
            try:
                return int(float(a["value"]))
            except (TypeError, ValueError):
                return 0
    return 0


# =============================================================================
# Fenêtres de calcul
# =============================================================================

def window_last_n_days(n=7, tz=TZ, anchor=None):
    end = anchor or datetime.now(tz)
    start = end - timedelta(days=n)
    return start, end


def parse_ghl_dt(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ)


def in_window(dt, start, end):
    return dt is not None and start <= dt <= end


def money(v):
    return f"{round(v):,}".replace(",", " ") + " $"


def _tgt(key):
    t = TARGETS[key]
    return {"target": t["target"], "dir": t["dir"], "targetLabel": t["label"]}


def pct_change(cur, prev):
    if prev in (None, 0):
        return None
    return round(100 * (cur - prev) / prev)


# =============================================================================
# VENTES — funnel + KPIs (fenêtre courante uniquement, voir décision du 2026-08-17
# : pas d'historique pré-changement de pipeline cette phase-ci)
# =============================================================================

def fetch_ghl_raw():
    """Un seul aller-retour réseau pour chaque source, réutilisé pour la
    fenêtre courante ET la fenêtre précédente (CAC — voir build_cac)."""
    setting_opps = ghl_search_opportunities(GHL_PIPELINES["setting"])
    closing_won_opps = ghl_search_opportunities(GHL_PIPELINES["closing"], {"status": GHL_WON_STATUS})
    return setting_opps, closing_won_opps


def fetch_calendar_events(start_ms, end_ms):
    events = []
    for cal_id in GHL_CALENDAR_IDS:
        try:
            events.extend(ghl_calendar_events(cal_id, start_ms, end_ms))
        except urllib.error.HTTPError as e:
            print(f"  ! calendrier {cal_id} : HTTP {e.code}, ignoré", file=sys.stderr)
    return events


def count_leads_in_window(setting_opps, start, end):
    return sum(1 for o in setting_opps if in_window(parse_ghl_dt(o.get("createdAt")), start, end))


def count_closings_in_window(closing_won_opps, start, end):
    rows = [o for o in closing_won_opps if in_window(parse_ghl_dt(o.get("lastStatusChangeAt")), start, end)]
    return rows


def build_ventes(setting_opps, closing_won_opps, events, jobber_quotes, start, end):
    leads = [o for o in setting_opps if in_window(parse_ghl_dt(o.get("createdAt")), start, end)]

    booked = [e for e in events if e.get("appointmentStatus") != "cancelled"
              and in_window(parse_ghl_dt(e.get("dateAdded")), start, end)]
    now = datetime.now(TZ)
    visited = [e for e in booked if parse_ghl_dt(e.get("startTime")) and parse_ghl_dt(e.get("startTime")) < now]

    # Contact jour-même — APPROXIMATION, voir commentaire dans le chat/README :
    # pas de log de contact dans GHL. Proxy = RDV pris le jour même du lead.
    same_day_contacts = 0
    for lead in leads:
        contact_id = lead.get("contactId")
        lead_day = parse_ghl_dt(lead.get("createdAt"))
        if not contact_id or not lead_day:
            continue
        for e in events:
            if e.get("contactId") != contact_id:
                continue
            booked_at = parse_ghl_dt(e.get("dateAdded"))
            if booked_at and booked_at.date() == lead_day.date():
                same_day_contacts += 1
                break

    submissions = [q for q in jobber_quotes if q.get("sentAt")
                   and in_window(parse_ghl_dt(q["sentAt"]), start, end)]

    closings = count_closings_in_window(closing_won_opps, start, end)

    n_leads = len(leads)
    n_rdv = len(booked)
    n_visits = len(visited)
    n_subs = len(submissions)
    n_close = len(closings)

    deal_values = [o.get("monetaryValue", 0) for o in closings if o.get("monetaryValue")]
    avg_deal = round(sum(deal_values) / len(deal_values)) if deal_values else 0

    pct_contact = round(100 * same_day_contacts / n_leads) if n_leads else 0
    pct_rdv = round(100 * n_rdv / n_leads) if n_leads else 0
    pct_close = round(100 * n_close / n_subs) if n_subs else 0

    funnel = [
        {"s": "Leads", "n": n_leads},
        {"s": "Contactés jour-même", "n": same_day_contacts},
        {"s": "RDV bookés", "n": n_rdv},
        {"s": "Visites réalisées", "n": n_visits},
        {"s": "Soumissions envoyées", "n": n_subs},
        {"s": "Closings", "n": n_close},
    ]

    ventes = [
        {"k": "contact", "label": "Contact jour-même", "v": pct_contact, "disp": f"{pct_contact} %",
         **_tgt("contact"), "sub": "approx. (RDV pris jour même)"},
        {"k": "rdv", "label": "Taux de RDV booké", "v": pct_rdv, "disp": f"{pct_rdv} %", **_tgt("rdv")},
        {"k": "close", "label": "Taux de closing", "v": pct_close, "disp": f"{pct_close} %", **_tgt("close")},
        {"k": "deal", "label": "Valeur moyenne / deal", "v": avg_deal, "disp": money(avg_deal), **_tgt("deal")},
    ]

    return ventes, funnel, closings


# =============================================================================
# CAC + ses deux leviers (CPL et conversion lead->client)
# =============================================================================

def build_acq(spend_a, leads_a, n_close_a, spend_b, leads_b, n_close_b):
    cpl_a = round(spend_a / leads_a, 2) if leads_a else None
    cpl_b = round(spend_b / leads_b, 2) if leads_b else None
    cac_a = round(spend_a / n_close_a) if n_close_a else None
    cac_b = round(spend_b / n_close_b) if n_close_b else None
    conv_a = round(100 * n_close_a / leads_a, 1) if leads_a else None
    conv_b = round(100 * n_close_b / leads_b, 1) if leads_b else None

    cpl_delta = pct_change(cpl_a, cpl_b)
    conv_delta = pct_change(conv_a, conv_b)
    cac_delta = pct_change(cac_a, cac_b)

    # diagnostic : qui bouge le CAC ?
    if cac_delta is None or cpl_delta is None or conv_delta is None:
        driver_text = "Pas assez d'historique (semaine précédente) pour départager les deux leviers."
    elif cac_delta <= 0:
        driver_text = "CAC stable ou en baisse — rien à corriger cette semaine."
    else:
        # le lever qui a le plus bougé DANS LE MAUVAIS SENS explique la hausse
        cpl_bad = cpl_delta if cpl_delta and cpl_delta > 0 else 0
        conv_bad = -conv_delta if conv_delta and conv_delta < 0 else 0
        if cpl_bad >= conv_bad and cpl_bad > 0:
            driver_text = f"CAC en hausse de {cac_delta} % — poussé par le CPL (+{cpl_delta} %). Le pub coûte plus cher au lead, pas un problème de conversion. Voir section FB Ads pour la cause exacte."
        elif conv_bad > 0:
            driver_text = f"CAC en hausse de {cac_delta} % — poussé par la conversion lead→client qui a chuté de {abs(conv_delta)} %. Le pub reste efficace, le problème est dans le funnel de vente (RDV/visites/soumissions/closing)."
        else:
            driver_text = f"CAC en hausse de {cac_delta} % sans levier dominant clair — CPL {('+' if (cpl_delta or 0) >= 0 else '')}{cpl_delta} %, conversion {('+' if (conv_delta or 0) >= 0 else '')}{conv_delta} %."

    acq = [
        {"k": "cpl", "label": "Coût par lead", "v": cpl_a, "disp": money(cpl_a) if cpl_a is not None else "—",
         **_tgt("cpl"), "sub": f"{'+' if (cpl_delta or 0) >= 0 else ''}{cpl_delta} % vs sem. préc." if cpl_delta is not None else None},
        {"k": "cac", "label": "Coût d'acquisition client", "v": cac_a, "disp": money(cac_a) if cac_a is not None else "—",
         **_tgt("cac"), "sub": f"{'+' if (cac_delta or 0) >= 0 else ''}{cac_delta} % vs sem. préc." if cac_delta is not None else "voir diagnostic ci-dessous"},
        {"k": "leads", "label": "Leads générés (Meta)", "v": leads_a, "disp": str(leads_a), "target": None,
         "sub": f"conversion lead→client {conv_a} %" if conv_a is not None else None},
        {"k": "spend", "label": "Dépense pub", "v": spend_a, "disp": money(spend_a), "target": None},
    ]
    return acq, {
        "cpl_current": cpl_a, "cpl_previous": cpl_b, "cpl_change_pct": cpl_delta,
        "conversion_current": conv_a, "conversion_previous": conv_b, "conversion_change_pct": conv_delta,
        "cac_current": cac_a, "cac_previous": cac_b, "cac_change_pct": cac_delta,
        "driver_text": driver_text,
    }


# =============================================================================
# FB ADS — ad set (COUPER/SCALER) + créa (FATIGUE/ANGLE/DIVERSITÉ)
# =============================================================================

def _num(row, key, default=0.0):
    try:
        return float(row.get(key, default) or default)
    except (TypeError, ValueError):
        return default


def _index_by(rows, key):
    return {r[key]: r for r in rows if r.get(key)}


def merge_window_rows(rows_a, rows_b, id_key, name_key):
    idx_a, idx_b = _index_by(rows_a, id_key), _index_by(rows_b, id_key)
    out = []
    for rid in set(idx_a) | set(idx_b):
        a, b = idx_a.get(rid), idx_b.get(rid)
        name = (a or b).get(name_key, "")
        spend_a, spend_b = _num(a or {}, "spend"), _num(b or {}, "spend")
        leads_a = meta_leads_count(a) if a else 0
        leads_b = meta_leads_count(b) if b else 0
        out.append({
            "id": rid,
            "name": name,
            "adset_name": (a or b).get("adset_name", name),
            "spend_a": spend_a, "spend_b": spend_b,
            "leads_a": leads_a, "leads_b": leads_b,
            "cpl_a": round(spend_a / leads_a, 2) if leads_a else None,
            "cpl_b": round(spend_b / leads_b, 2) if leads_b else None,
            "cpm_a": round(_num(a or {}, "cpm"), 2), "cpm_b": round(_num(b or {}, "cpm"), 2),
            "ctr_a": round(_num(a or {}, "ctr"), 2), "ctr_b": round(_num(b or {}, "ctr"), 2),
            "freq_a": round(_num(a or {}, "frequency"), 2), "freq_b": round(_num(b or {}, "frequency"), 2),
            "impressions_a": int(_num(a or {}, "impressions")), "impressions_b": int(_num(b or {}, "impressions")),
        })
    out.sort(key=lambda r: -r["spend_a"])
    return out


def classify_angle(name):
    low = name.lower()
    for angle, keywords in ANGLE_KEYWORDS:
        if any(kw in low for kw in keywords):
            return angle
    return "autre / non classé"


def significant(row):
    return row["spend_a"] >= FBADS_MIN_SPEND_SIGNIFICANT or row["leads_a"] >= FBADS_MIN_LEADS_SIGNIFICANT


def reco_couper(adsets):
    out = []
    for r in adsets:
        if r["cpl_a"] is None or not significant(r):
            continue
        if r["cpl_a"] > FBADS_CPL_CUT:
            out.append({
                "type": "couper", "level": "adset", "target": r["name"],
                "title": f"Couper / réduire — {r['name']}",
                "text": (f"CPL à {money(r['cpl_a'])} sur {money(r['spend_a'])} dépensés "
                         f"/ {r['leads_a']} leads cette semaine — au-dessus du seuil de {money(FBADS_CPL_CUT)} "
                         f"et de ta cible ({TARGETS['cpl']['label']}). Suggestion : mets en pause ou réalloue "
                         f"ce budget vers un ad set plus performant."),
            })
    return out


def reco_scaler(adsets):
    out = []
    for r in adsets:
        if r["cpl_a"] is None or not significant(r):
            continue
        freq_stable_or_down = r["freq_b"] == 0 or r["freq_a"] <= r["freq_b"] + 0.15
        if r["cpl_a"] < FBADS_CPL_SCALE and freq_stable_or_down:
            out.append({
                "type": "scaler", "level": "adset", "target": r["name"],
                "title": f"Scaler — {r['name']}",
                "text": (f"CPL à {money(r['cpl_a'])}, bien sous ta cible ({TARGETS['cpl']['label']}), "
                         f"fréquence {'stable' if r['freq_b'] else 'stable (pas de comparatif)'} "
                         f"({r['freq_a']} vs {r['freq_b']} sem. préc.). Suggestion : +20 % de budget sur cet ad set."),
            })
    return out


def reco_fatigue(ads):
    out = []
    for r in ads:
        if r["cpl_b"] is None or r["ctr_b"] in (None, 0) or r["cpl_a"] is None:
            continue
        freq_high = r["freq_a"] >= FBADS_FREQ_FATIGUE
        ctr_down = r["ctr_a"] < r["ctr_b"] * 0.9
        cpl_up = r["cpl_a"] > r["cpl_b"] * 1.1
        if freq_high and ctr_down and cpl_up:
            out.append({
                "type": "fatigue", "level": "ad", "target": r["name"],
                "title": f"Fatigue créative — {r['name']}",
                "text": (f"Fréquence {r['freq_a']} (>= {FBADS_FREQ_FATIGUE}), CTR {r['ctr_a']} % "
                         f"(vs {r['ctr_b']} % sem. préc., {'-' if r['ctr_b'] else ''}"
                         f"{round(100*(1-r['ctr_a']/r['ctr_b'])) if r['ctr_b'] else '?'} %), "
                         f"CPL {money(r['cpl_a'])} (vs {money(r['cpl_b'])}, +{round(100*(r['cpl_a']/r['cpl_b']-1))} %). "
                         f"Les trois bougent ensemble = signal de fatigue, pas du bruit. Suggestion : rafraîchis "
                         f"cette créa — ton format le plus fort reste le UGC caméra-à-toi."),
            })
    return out


def reco_angle(ads):
    buckets = {}
    for r in ads:
        angle = classify_angle(r["name"])
        b = buckets.setdefault(angle, {"spend": 0.0, "leads": 0, "ads": [], "impressions": 0})
        b["spend"] += r["spend_a"]
        b["leads"] += r["leads_a"]
        b["impressions"] += r["impressions_a"]
        b["ads"].append(r["name"])
    scored = []
    for angle, b in buckets.items():
        if b["spend"] < FBADS_MIN_SPEND_SIGNIFICANT:
            continue
        cpl = round(b["spend"] / b["leads"], 2) if b["leads"] else None
        ctr = None  # non recalculé ici (moyenne pondérée par clic non dispo simplement) — CPL suffit à trancher
        scored.append({"angle": angle, "spend": b["spend"], "leads": b["leads"], "cpl": cpl, "ads": b["ads"]})
    scored = [s for s in scored if s["cpl"] is not None]
    scored.sort(key=lambda s: s["cpl"])
    if len(scored) < 2:
        return []
    best, worst = scored[0], scored[-1]
    if best["angle"] == worst["angle"]:
        return []
    return [{
        "type": "angle", "level": "ad", "target": best["angle"],
        "title": f"Angle gagnant — {best['angle']}",
        "text": (f"\"{best['angle']}\" à {money(best['cpl'])}/lead ({best['leads']} leads, {money(best['spend'])} dépensés — "
                 f"pubs : {', '.join(best['ads'])}) bat \"{worst['angle']}\" à {money(worst['cpl'])}/lead "
                 f"({worst['leads']} leads — pubs : {', '.join(worst['ads'])}). Mets plus de budget/nouvelles variantes "
                 f"sur \"{best['angle']}\"."),
    }]


def reco_diversite(ads):
    total = sum(r["spend_a"] for r in ads)
    if total <= 0:
        return []
    out = []
    for r in ads:
        if r["spend_a"] / total >= FBADS_DIVERSITY_SHARE:
            out.append({
                "type": "diversite", "level": "ad", "target": r["name"],
                "title": f"Manque de diversité — {r['name']}",
                "text": (f"\"{r['name']}\" porte {round(100*r['spend_a']/total)} % de la dépense totale cette semaine "
                         f"({money(r['spend_a'])} sur {money(total)}). Si cette créa fatigue ou est coupée par Meta, "
                         f"tout le compte encaisse. Suggestion : ajoute 2-3 variantes (autres angles ou UGC) pour "
                         f"répartir le risque."),
            })
    return out


def build_fbads(since_a, until_a, since_b, until_b):
    adset_rows_a = meta_insights("adset", since_a, until_a)
    adset_rows_b = meta_insights("adset", since_b, until_b)
    ad_rows_a = meta_insights("ad", since_a, until_a)
    ad_rows_b = meta_insights("ad", since_b, until_b)

    adsets = merge_window_rows(adset_rows_a, adset_rows_b, "adset_id", "adset_name")
    ads = merge_window_rows(ad_rows_a, ad_rows_b, "ad_id", "ad_name")

    recos = (
        reco_couper(adsets) + reco_scaler(adsets) +
        reco_fatigue(ads) + reco_angle(ads) + reco_diversite(ads)
    )

    spend_a_total = sum(r["spend_a"] for r in adsets)
    leads_a_total = sum(r["leads_a"] for r in adsets)
    spend_b_total = sum(r["spend_b"] for r in adsets)
    leads_b_total = sum(r["leads_b"] for r in adsets)

    return {
        "window_current": {"since": since_a.isoformat(), "until": until_a.isoformat()},
        "window_previous": {"since": since_b.isoformat(), "until": until_b.isoformat()},
        "adsets": adsets,
        "ads": ads,
        "recommendations": recos,
    }, spend_a_total, leads_a_total, spend_b_total, leads_b_total


# =============================================================================
# Streaks / historique
# =============================================================================

def load_history():
    if os.path.exists(HISTORY_PATH):
        try:
            with open(HISTORY_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []
    return []


def append_history(history, ventes, acq, run_dt, max_entries=180):
    row = {"date": run_dt.date().isoformat()}
    for k in ventes + acq:
        if k.get("v") is not None:
            row[k["k"]] = k["v"]
    history.append(row)
    return history[-max_entries:]


def compute_streak(history, kpi_key, current_status_fn):
    """Compte combien de runs consécutifs (en remontant depuis le dernier)
    ont le même statut good/watch/bad que le run courant."""
    streak = 0
    for row in reversed(history):
        if kpi_key not in row:
            break
        if current_status_fn(row[kpi_key]) != current_status_fn(history[-1].get(kpi_key)):
            break
        streak += 1
    return max(streak, 1)


def status_of(v, target, direction):
    if v is None or target is None:
        return "none"
    if direction == "up":
        return "good" if v >= target else ("watch" if v >= target * 0.85 else "bad")
    return "good" if v <= target else ("watch" if v <= target * 1.15 else "bad")


def apply_streaks(ventes, acq, history):
    if not history:
        for k in ventes + acq:
            k["streak"] = 1
        return
    for k in ventes + acq:
        target = TARGETS.get(k["k"], {}).get("target")
        direction = TARGETS.get(k["k"], {}).get("dir")
        if target is None or k.get("v") is None:
            k["streak"] = 1
            continue
        fn = lambda v, t=target, d=direction: status_of(v, t, d)
        k["streak"] = compute_streak(history, k["k"], fn)


# =============================================================================
# main
# =============================================================================

def main():
    missing = [k for k in ("GHL_TOKEN", "GHL_LOCATION_ID") if not os.environ.get(k)]
    if missing:
        print(f"Variables manquantes : {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(TZ)
    start_a, end_a = window_last_n_days(7, anchor=now)
    start_b, end_b = window_last_n_days(7, anchor=start_a)
    print(f"Fenêtre courante   : {start_a.isoformat()} -> {end_a.isoformat()}")
    print(f"Fenêtre précédente : {start_b.isoformat()} -> {end_b.isoformat()}")

    print("\n[1/4] GHL — opportunités SETTING + CLOSING (won)...")
    setting_opps, closing_won_opps = fetch_ghl_raw()
    print(f"  {len(setting_opps)} leads SETTING (tout historique), {len(closing_won_opps)} closings gagnés (tout historique)")

    print("[2/4] GHL — calendrier (RDV/visites)...")
    events = fetch_calendar_events(int(start_b.timestamp() * 1000), int(end_a.timestamp() * 1000))
    print(f"  {len(events)} événements (fenêtre élargie)")

    print("[3/4] Jobber — quotes (soumissions envoyées, lecture seule)...")
    jobber_quotes = []
    if JOBBER_REFRESH_TOKEN:
        try:
            token = jobber_access_token()
            jobber_quotes = jobber_recent_quotes(token, start_b)
            print(f"  {len(jobber_quotes)} quotes récupérées")
        except Exception as e:
            print(f"  ! Jobber indisponible : {e}", file=sys.stderr)
    else:
        print("  ! JOBBER_REFRESH_TOKEN absent — Soumissions envoyées = 0", file=sys.stderr)

    ventes, funnel, closings_a = build_ventes(setting_opps, closing_won_opps, events, jobber_quotes, start_a, end_a)
    leads_a_ghl = funnel[0]["n"]
    n_close_a = len(closings_a)
    closings_b = count_closings_in_window(closing_won_opps, start_b, end_b)
    n_close_b = len(closings_b)

    print("\n=== VENTES (7 derniers jours) ===")
    for k in ventes:
        print(f"  {k['label']}: {k['disp']}")
    print("\n=== FUNNEL ===")
    for f in funnel:
        print(f"  {f['s']}: {f['n']}")

    fbads = None
    acq = None
    if META_TOKEN and META_AD_ACCOUNT:
        print("\n[4/4] Meta — insights ad set + ad, 2 fenêtres...")
        fbads, spend_a, leads_a_meta, spend_b, leads_b_meta = build_fbads(
            start_a.date(), end_a.date(), start_b.date(), end_b.date()
        )
        acq, cac_levers = build_acq(spend_a, leads_a_meta, n_close_a, spend_b, leads_b_meta, n_close_b)
        print("\n=== ACQUISITION (CAC + leviers) ===")
        for k in acq:
            print(f"  {k['label']}: {k['disp']}" + (f" — {k['sub']}" if k.get("sub") else ""))
        print(f"\n=== FB ADS — {len(fbads['recommendations'])} recommandations ===")
        for r in fbads["recommendations"]:
            print(f"  [{r['type'].upper()}] {r['title']}")
            print(f"    {r['text']}")
    else:
        print("\n! META_TOKEN/META_AD_ACCOUNT absents — acq et fbads non calculés", file=sys.stderr)
        acq = [
            {"k": "cpl", "label": "Coût par lead", "v": None, "disp": "—", **_tgt("cpl")},
            {"k": "cac", "label": "Coût d'acquisition client", "v": None, "disp": "—", **_tgt("cac")},
            {"k": "leads", "label": "Leads générés", "v": leads_a_ghl, "disp": str(leads_a_ghl), "target": None},
            {"k": "spend", "label": "Dépense pub", "v": None, "disp": "—", "target": None},
        ]

    history = load_history()
    apply_streaks(ventes, acq, history)
    history = append_history(history, ventes, acq, now)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HISTORY_PATH, "w") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)

    period = {
        "label": f"{start_a.strftime('%d %b')} – {end_a.strftime('%d %b %Y')}",
        "ventes": ventes,
        "acq": acq,
        "rent": RENT_PARKED,
        "funnel": funnel,
        "cac_levers": cac_levers if META_TOKEN and META_AD_ACCOUNT else None,
    }
    out = {
        "source": "live",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "labor_trend": [],
        "season": [],
        "periods": {"current": period},
    }
    if fbads:
        out["fbads"] = fbads

    with open(KPIS_PATH, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"\nÉcrit -> {KPIS_PATH}")
    print(f"Écrit -> {HISTORY_PATH}")


if __name__ == "__main__":
    main()
