import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Check, AlertTriangle, X,
  Phone, CalendarCheck, Target, DollarSign, Users, Megaphone,
  Wrench, Percent, Activity, ChevronDown, RefreshCw, Wifi, WifiOff,
  Flame, ArrowUpRight, AlertOctagon, Compass,
} from "lucide-react";

/* ============================================================
   MAG · Cockpit KPI + moteur de diagnostic
   - Lit docs/data/daily.json (série journalière, comptes bruts) +
     docs/data/kpis.json (FB Ads + Rentabilité parquée). Sinon -> démo.
   - Le front agrège n'importe quelle plage à partir de daily.json : on somme
     les numérateurs/dénominateurs sur la fenêtre PUIS on divise (jamais de
     moyenne de taux journaliers).
   - Cible closing = 35 %. Au-dessus de 45 % trop longtemps -> monte les prix.
   - Rouge -> d'où vient le problème (remonte l'entonnoir).
   - Vert trop longtemps -> prochaine étape.
   - FB Ads (sous Acquisition) : recos COUPER/SCALER/FATIGUE/ANGLE/DIVERSITÉ,
     toujours des suggestions à approuver — aucune mutation de campagne.
   ============================================================ */

const C = {
  ink: "#0A0A0A", panel: "#141517", panel2: "#191B1E", line: "#26292D",
  teal: "#2DC5A2", tealDim: "#1E7A66", text: "#EAECEE", muted: "#868D95",
  amber: "#F0B454", red: "#EE5F5B",
};

const CLOSE_FLOOR = 35;   // sous ça = problème
const CLOSE_CEIL = 45;    // au-dessus trop longtemps = sous-tarifé

// Cibles — DOIT rester synchro avec TARGETS/CLOSE_FLOOR/CLOSE_CEIL côté
// scripts/build_kpis.py (une seule source de vérité, voir CLAUDE.md).
const TARGETS = {
  contact: { target: 80, dir: "up", label: "≥ 80 %" },
  rdv: { target: 60, dir: "up", label: "≥ 60 %" },
  close: { target: 35, dir: "up", label: "35–45 %" },
  deal: { target: 2400, dir: "up", label: "≥ 2 400 $" },
  cpl: { target: 21, dir: "down", label: "17–21 $" },
  cac: { target: 350, dir: "down", label: "≤ 350 $" },
};

const STATUS = {
  good: { c: C.teal, label: "sur la cible", Icon: Check },
  watch: { c: C.amber, label: "à surveiller", Icon: AlertTriangle },
  bad: { c: C.red, label: "hors cible", Icon: X },
  none: { c: C.muted, label: "", Icon: Activity },
};

const ICONS = {
  contact: Phone, rdv: CalendarCheck, close: Target, deal: DollarSign,
  cpl: Megaphone, cps: DollarSign, cac: Target, leads: Users, spend: DollarSign,
  labor: Users, rework: Wrench, marge: Percent, rpp: Activity,
};

function statusOf(v, target, dir) {
  if (target == null || v == null) return "none";
  if (dir === "up") return v >= target ? "good" : v >= target * 0.85 ? "watch" : "bad";
  return v <= target ? "good" : v <= target * 1.15 ? "watch" : "bad";
}
function getK(P, section, key) { return (P[section] || []).find((x) => x.k === key); }

/* ============================================================
   MOTEUR DE CONSEILS — un message par KPI selon état + durée
   tone: "fix" (rouge), "push" (vert trop longtemps / monte les prix), "watch"
   ============================================================ */
function adviceFor(kpi) {
  const { k, v } = kpi;
  const streak = kpi.streak || 1;
  const st = statusOf(v, kpi.target, kpi.dir);

  if (k === "close") {
    if (v > CLOSE_CEIL)
      return { tone: "push", title: "Closing trop haut — monte tes prix",
        text: `Tu closes ${v} %, bien au-dessus de ta cible de ${CLOSE_FLOOR} %. Tu closes trop facile = tes prix sont trop bas. Monte-les de 5–10 % pis observe : tant que tu restes au-dessus de ${CLOSE_FLOOR} %, remonte encore. L'objectif c'est le $ par job, pas le taux.` };
    if (v < CLOSE_FLOOR)
      return { tone: "fix", title: "Closing sous la cible — d'où ça vient",
        text: `Sous ${CLOSE_FLOOR} %. Trois suspects dans l'ordre : (1) prix trop hauts pour le segment → check ton taux de closing par tranche de prix ; (2) pitch de valeur faible sur place → travaille la démo avant/après ; (3) leads pas qualifiés → resserre le ciblage Meta. Si tu perds surtout sur le prix avec des bons leads, c'est le pitch ; si tu perds des leads pas sérieux, c'est le ciblage.` };
    if (st === "good" && streak >= 3)
      return { tone: "push", title: "Zone saine — prochaine étape",
        text: `Closing stable dans la zone ${CLOSE_FLOOR}–${CLOSE_CEIL} % depuis ${streak} périodes équivalentes. Prochaine étape : pousse le panier moyen (upsells relevelage / sable premium / murets) plutôt que le taux.` };
    return null;
  }
  if (k === "deal") {
    if (st === "bad") return { tone: "fix", title: "Panier moyen bas",
      text: `Sous 2 400 $. Systématise les upsells (relevelage, sable premium, murets) et respecte ton minimum de job. Un bundle proposé par défaut monte le panier sans baisser le closing.` };
    if (st === "good" && streak >= 3) return { tone: "push", title: "Panier solide — teste plus haut",
      text: `Panier au-dessus de la cible depuis ${streak} périodes équivalentes. Teste un tier de prix plus élevé sur les grosses surfaces / gros joints et regarde si le closing tient.` };
    return null;
  }
  if (k === "cpl") {
    if (st === "bad") return { tone: "fix", title: "CPL trop cher",
      text: `Coût par lead au-dessus de 21 $. Regarde la section FB Ads plus bas — les ad sets/créas fautifs sont identifiés avec les chiffres exacts, pas de règle générale ici.` };
    if (st === "watch") return { tone: "watch", title: "CPL à surveiller",
      text: `Un peu au-dessus de la cible. Surveille la fréquence ; prépare 1–2 nouvelles créas avant que ça dérape.` };
    if (st === "good" && streak >= 3) return { tone: "push", title: "CPL sous contrôle — scale",
      text: `Prochaine étape : monte le budget +20 % sur le meilleur ad set (voir section FB Ads), ou ouvre un lookalike sur tes clients closés.` };
    return null;
  }
  if (k === "contact") {
    if (st !== "good") return { tone: st === "bad" ? "fix" : "watch", title: "Contact jour-même trop lent",
      text: `Chaque heure de délai coûte des RDV. Automatise le rappel/SMS immédiat (missed-call text-back GHL) pour rejoindre 80 %+ le jour même.` };
    return null;
  }
  if (k === "rdv") {
    if (st !== "good") return { tone: st === "bad" ? "fix" : "watch", title: "Taux de RDV sous la cible",
      text: `Le lead répond mais tu bookes pas. Travaille le script de qualif du premier appel : cadre la visite comme l'étape par défaut, propose 2 créneaux fermés.` };
    return null;
  }
  if (k === "labor") {
    if (st === "bad") return { tone: "fix", title: "Main-d'œuvre mange la marge",
      text: `${v} % du CA vs cible 30–35 %. Chez toi les coupables habituels : heures invisibles (pas de punch Jobber), overtime sur tes top producteurs, revenu/personne qui chute sur les grosses équipes. Attaque le punch-in d'abord — sans données d'heures, le reste est aveugle.` };
    if (st === "good" && streak >= 3) return { tone: "push", title: "Main-d'œuvre dans la cible",
      text: `Verrouille le gain : fixe un standard d'heures par type de job et flag automatiquement les dépassements.` };
    return null;
  }
  if (k === "rework") {
    if (st !== "good") return { tone: st === "bad" ? "fix" : "watch", title: "Trop de reprises",
      text: `${String(v).replace(".", ",")} % vs cible ≤ 4 %. Corrèle avec la température à l'install (le sable polymère prend mal au froid) et le respect de la fiche technique. Les jobs d'avril à froid sont tes pires — bloque un seuil de température minimum.` };
    return null;
  }
  if (k === "marge") {
    if (st !== "good") return { tone: st === "bad" ? "fix" : "watch", title: "Marge sous la cible",
      text: `Attaque les deux leviers en même temps : main-d'œuvre (le plus gros chez toi) et panier moyen. La hausse de prix de juillet doit se voir ici — sinon elle est mangée par les heures.` };
    return null;
  }
  if (k === "rpp") {
    if (st !== "good") return { tone: st === "bad" ? "fix" : "watch", title: "Revenu par personne faible",
      text: `Le revenu/personne/jour baisse souvent quand les équipes sont trop grosses. Regarde la taille de crew par type de job — une équipe de 2 bien staffée bat souvent une de 4 mal utilisée.` };
    return null;
  }
  return null;
}

/* Diagnostic global : le $ closé baisse -> remonte l'entonnoir pour trouver le maillon */
function diagnose(P, prev) {
  const dealK = getK(P, "ventes", "deal");
  const closeK = getK(P, "ventes", "close");
  const curClos = P.funnel[P.funnel.length - 1].n;
  const cur$ = curClos * (dealK?.v || 0);

  if (!prev) {
    return { tone: "watch", title: "Pas de période de comparaison",
      text: "La période précédente équivalente n'a pas assez de données (avant le début de l'historique). Choisis une plage plus courte pour voir le diagnostic complet." };
  }
  const prevDeal = getK(prev, "ventes", "deal");
  const prevClos = prev.funnel[prev.funnel.length - 1].n;
  const prev$ = prevClos * (prevDeal?.v || 0);

  // $ stable ou en hausse -> prochaine priorité
  if (cur$ >= prev$ * 0.95) {
    if ((closeK?.v || 0) > CLOSE_CEIL)
      return { tone: "push", title: "Priorité : monte tes prix",
        text: `Le $ closé tient (≈ ${money(cur$)}). Ton closing à ${closeK.v} % dit que tu laisses de l'argent sur la table — hausse de 5–10 % à tester en premier.` };
    return { tone: "push", title: "Priorité : garde le haut de l'entonnoir plein",
      text: `Le $ closé progresse (≈ ${money(cur$)}). Le risque saisonnier, c'est le volume : maintiens les soumissions envoyées, scale le meilleur ad set.` };
  }

  // $ en baisse -> trouve le premier maillon qui lâche (du haut vers le bas)
  const stages = P.funnel.map((f, i) => {
    const p = prev.funnel[i];
    const drop = p && p.n ? 1 - f.n / p.n : 0;
    return { s: f.s, cur: f.n, prev: p ? p.n : null, drop };
  });
  const culprit = stages.find((s) => s.drop > 0.1);
  const dealDrop = prevDeal?.v ? 1 - (dealK?.v || 0) / prevDeal.v : 0;

  if (!culprit && dealDrop > 0.1)
    return { tone: "fix", title: "Baisse de $ = panier moyen en chute",
      text: `Ton volume tient mais le panier moyen a baissé de ${Math.round(dealDrop * 100)} %. C'est un problème de mix / d'upsell, pas de génération de leads.` };

  if (!culprit)
    return { tone: "watch", title: "Baisse de $ diffuse",
      text: "Pas un seul maillon dominant — plusieurs étapes ont fléchi un peu. Regarde le levier avec le plus gros drop dans l'entonnoir." };

  const closesDown = stages[stages.length - 1].drop > 0.1;
  const map = {
    "Leads": `Le problème est en haut : les leads ont chuté de ${Math.round(culprit.drop * 100)} %. C'est de l'acquisition (budget/créa Meta), pas ton closing.`,
    "Contactés jour-même": `Tu rappelles pas assez vite : les contacts jour-même ont baissé de ${Math.round(culprit.drop * 100)} %. Automatise le rappel immédiat.`,
    "RDV bookés": `Tu bookes moins de RDV (−${Math.round(culprit.drop * 100)} %). Le problème est ton script de premier appel, pas la visite.`,
    "Visites réalisées": `Trop de no-show : les visites ont chuté de ${Math.round(culprit.drop * 100)} %. Ajoute un SMS de confirmation la veille.`,
    "Soumissions envoyées": `Le $ baisse parce que t'as envoyé ${Math.round(culprit.drop * 100)} % moins de soumissions — le problème est en amont, PAS ton taux de closing. Remplis le haut de l'entonnoir.`,
    "Closings": `Ton volume de soumissions tient mais tu closes moins (−${Math.round(culprit.drop * 100)} %). Là c'est le prix ou le pitch.`,
  };
  let text = map[culprit.s] || `Maillon faible : ${culprit.s} (−${Math.round(culprit.drop * 100)} %).`;
  if (culprit.s !== "Closings" && !closesDown)
    text += " Ton taux de closing est correct — inutile de baisser tes prix.";
  return { tone: "fix", title: "D'où vient la baisse de $", text };
}

function money(v) {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString("fr-CA")} $`.replace(/ |,/g, " ");
}

/* ============================================================
   DATES — tout en calendrier pur (chaînes YYYY-MM-DD), lundi = début de
   semaine. Le "aujourd'hui" est calculé en America/Toronto pour matcher le
   bucketing du builder, pas le fuseau du navigateur du visiteur.
   ============================================================ */
function todayInTZ(tz = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function toEpochDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function fromEpochDay(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
function addDays(iso, n) {
  return fromEpochDay(toEpochDay(iso) + n);
}
function mondayOf(iso) {
  const day = new Date(iso + "T00:00:00Z").getUTCDay(); // 0=dim...6=sam
  const offset = (day + 6) % 7;
  return addDays(iso, -offset);
}
function fmtDateShort(iso) {
  const [, m, d] = iso.split("-");
  const MOIS = ["", "jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
  return `${parseInt(d, 10)} ${MOIS[parseInt(m, 10)]}`;
}

const RANGE_OPTIONS = [
  { key: "ytd", label: "YTD" },
  { key: "mtd", label: "Ce mois-ci" },
  { key: "last_month", label: "Le dernier mois" },
  { key: "d30", label: "Derniers 30 jours" },
  { key: "d14", label: "Derniers 14 jours" },
  { key: "d7", label: "Derniers 7 jours" },
  { key: "this_week", label: "Cette semaine" },
  { key: "last_week", label: "Semaine dernière" },
  { key: "custom", label: "Custom" },
];

function computeRange(rangeKey, todayIso, customStart, customEnd) {
  const monday = mondayOf(todayIso);
  const lastMonday = addDays(monday, -7);
  const lastSunday = addDays(monday, -1);
  const firstOfMonth = todayIso.slice(0, 7) + "-01";
  const prevMonthLastDay = addDays(firstOfMonth, -1);
  const prevMonthFirstDay = prevMonthLastDay.slice(0, 7) + "-01";
  switch (rangeKey) {
    case "ytd": return { start: `${todayIso.slice(0, 4)}-01-01`, end: todayIso };
    case "mtd": return { start: firstOfMonth, end: todayIso };
    case "last_month": return { start: prevMonthFirstDay, end: prevMonthLastDay };
    case "d30": return { start: addDays(todayIso, -29), end: todayIso };
    case "d14": return { start: addDays(todayIso, -13), end: todayIso };
    case "d7": return { start: addDays(todayIso, -6), end: todayIso };
    case "this_week": return { start: monday, end: todayIso };
    case "last_week": return { start: lastMonday, end: lastSunday };
    case "custom": return { start: customStart || addDays(todayIso, -6), end: customEnd || todayIso };
    default: return { start: addDays(todayIso, -6), end: todayIso };
  }
}
function previousEquivalent(start, end) {
  const len = toEpochDay(end) - toEpochDay(start) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(len - 1));
  return { start: prevStart, end: prevEnd };
}

/* ============================================================
   AGRÉGATION daily.json -> KPIs (sommer PUIS diviser, jamais l'inverse)
   ============================================================ */
const EMPTY_SUMS = { leads: 0, contacted: 0, rdv: 0, visits: 0, quotes: 0, closings: 0, won_value: 0, spend: 0 };

function aggregate(daily, start, end) {
  const s = toEpochDay(start), e = toEpochDay(end);
  const sums = { ...EMPTY_SUMS };
  for (const row of daily) {
    const t = toEpochDay(row.d);
    if (t >= s && t <= e) {
      for (const k in sums) sums[k] += row[k] || 0;
    }
  }
  return sums;
}
function hasRealData(sums) {
  return sums.leads > 0 || sums.spend > 0 || sums.closings > 0 || sums.quotes > 0;
}
function deriveKpis(sums) {
  const pct = (num, den) => (den ? Math.round((100 * num) / den) : 0);
  return {
    contact: pct(sums.contacted, sums.leads),
    rdv: pct(sums.rdv, sums.leads),
    close: pct(sums.closings, sums.quotes),
    deal: sums.closings ? Math.round(sums.won_value / sums.closings) : 0,
    cpl: sums.leads ? +(sums.spend / sums.leads).toFixed(2) : null,
    cac: sums.closings ? Math.round(sums.spend / sums.closings) : null,
    cps: sums.quotes ? +(sums.spend / sums.quotes).toFixed(2) : null,
    leads: sums.leads,
    spend: Math.round(sums.spend),
    conv: sums.leads ? +((100 * sums.closings) / sums.leads).toFixed(1) : null,
  };
}
function toFunnel(sums) {
  return [
    { s: "Leads", n: sums.leads },
    { s: "Contactés jour-même", n: sums.contacted },
    { s: "RDV bookés", n: sums.rdv },
    { s: "Visites réalisées", n: sums.visits },
    { s: "Soumissions envoyées", n: sums.quotes },
    { s: "Closings", n: sums.closings },
  ];
}
function pctChangeD(cur, prev) {
  if (prev == null || prev === 0 || cur == null) return null;
  return Math.round((100 * (cur - prev)) / prev);
}
function ptsDelta(cur, prev) {
  if (cur == null || prev == null) return null;
  return Math.round(cur - prev);
}

function computeStreak(daily, metricKey, start, end, target, dir, maxLookback = 24) {
  if (target == null) return 1;
  const len = toEpochDay(end) - toEpochDay(start) + 1;
  const cur0 = deriveKpis(aggregate(daily, start, end))[metricKey];
  if (cur0 == null) return 1;
  const targetStatus = statusOf(cur0, target, dir);
  let streak = 1;
  let curEnd = addDays(start, -1);
  let curStart = addDays(curEnd, -(len - 1));
  for (let i = 0; i < maxLookback; i++) {
    const sums = aggregate(daily, curStart, curEnd);
    if (!hasRealData(sums)) break;
    const v = deriveKpis(sums)[metricKey];
    if (v == null || statusOf(v, target, dir) !== targetStatus) break;
    streak++;
    curEnd = addDays(curStart, -1);
    curStart = addDays(curEnd, -(len - 1));
  }
  return streak;
}

function buildCacLevers(cur, prev) {
  const cplDelta = pctChangeD(cur.cpl, prev.cpl);
  const convDelta = prev.conv ? pctChangeD(cur.conv, prev.conv) : null;
  const cacDelta = pctChangeD(cur.cac, prev.cac);
  let driver_text;
  if (cacDelta == null || cplDelta == null || convDelta == null) {
    driver_text = "Pas assez d'historique sur la période précédente pour départager les deux leviers.";
  } else if (cacDelta <= 0) {
    driver_text = "CAC stable ou en baisse — rien à corriger sur cette période.";
  } else {
    const cplBad = cplDelta > 0 ? cplDelta : 0;
    const convBad = convDelta < 0 ? -convDelta : 0;
    if (cplBad >= convBad && cplBad > 0) {
      driver_text = `CAC en hausse de ${cacDelta} % — poussé par le CPL (+${cplDelta} %). Le pub coûte plus cher au lead, pas un problème de conversion. Voir section FB Ads pour la cause exacte.`;
    } else if (convBad > 0) {
      driver_text = `CAC en hausse de ${cacDelta} % — poussé par la conversion lead→client qui a chuté de ${Math.abs(convDelta)} %. Le pub reste efficace, le problème est dans le funnel de vente.`;
    } else {
      driver_text = `CAC en hausse de ${cacDelta} % sans levier dominant clair — CPL ${cplDelta >= 0 ? "+" : ""}${cplDelta} %, conversion ${convDelta >= 0 ? "+" : ""}${convDelta} %.`;
    }
  }
  return { cpl_change_pct: cplDelta, conversion_change_pct: convDelta, cac_change_pct: cacDelta, driver_text };
}

function buildPeriodView(daily, start, end) {
  const prevRange = previousEquivalent(start, end);
  const curSums = aggregate(daily, start, end);
  const prevSums = aggregate(daily, prevRange.start, prevRange.end);
  const cur = deriveKpis(curSums);
  const prev = deriveKpis(prevSums);
  const hasPrev = hasRealData(prevSums);

  const mk = (k, label, v, disp, tgt, sub) => {
    const t = TARGETS[k] || {};
    return {
      k, label, v, disp,
      target: tgt !== undefined ? tgt : (t.target ?? null),
      dir: t.dir ?? null,
      targetLabel: t.label ?? null,
      sub,
      delta: null,
      streak: 1,
    };
  };

  const streakClose = computeStreak(daily, "close", start, end, TARGETS.close.target, TARGETS.close.dir);
  const streakDeal = computeStreak(daily, "deal", start, end, TARGETS.deal.target, TARGETS.deal.dir);
  const streakCpl = computeStreak(daily, "cpl", start, end, TARGETS.cpl.target, TARGETS.cpl.dir);

  const ventes = [
    mk("contact", "Contact jour-même", cur.contact, `${cur.contact} %`, undefined, "approx. (RDV pris jour même)"),
    mk("rdv", "Taux de RDV booké", cur.rdv, `${cur.rdv} %`),
    mk("close", "Taux de closing", cur.close, `${cur.close} %`),
    mk("deal", "Valeur moyenne / deal", cur.deal, money(cur.deal)),
  ];
  ventes[0].delta = hasPrev ? { value: ptsDelta(cur.contact, prev.contact), unit: " pts" } : null;
  ventes[1].delta = hasPrev ? { value: ptsDelta(cur.rdv, prev.rdv), unit: " pts" } : null;
  ventes[2].delta = hasPrev ? { value: ptsDelta(cur.close, prev.close), unit: " pts" } : null;
  ventes[2].streak = streakClose;
  ventes[3].delta = hasPrev ? { value: pctChangeD(cur.deal, prev.deal), unit: " %" } : null;
  ventes[3].streak = streakDeal;

  const acq = [
    mk("cpl", "Coût par lead", cur.cpl, cur.cpl != null ? money(cur.cpl) : "—"),
    mk("cps", "Coût par soumission", cur.cps, cur.cps != null ? money(cur.cps) : "—", null, "cible à définir"),
    mk("cac", "Coût d'acquisition client", cur.cac, cur.cac != null ? money(cur.cac) : "—"),
    mk("leads", "Leads générés", cur.leads, String(cur.leads), null,
      cur.conv != null ? `conversion lead→client ${cur.conv} %` : null),
    mk("spend", "Dépense pub", cur.spend, money(cur.spend), null),
  ];
  acq[0].delta = hasPrev ? { value: pctChangeD(cur.cpl, prev.cpl), unit: " %" } : null;
  acq[0].streak = streakCpl;
  acq[1].delta = hasPrev ? { value: pctChangeD(cur.cps, prev.cps), unit: " %" } : null;
  acq[1].dir = "down";
  acq[2].delta = hasPrev ? { value: pctChangeD(cur.cac, prev.cac), unit: " %" } : null;
  acq[3].delta = hasPrev ? { value: pctChangeD(cur.leads, prev.leads), unit: " %" } : null;
  acq[4].delta = hasPrev ? { value: pctChangeD(cur.spend, prev.spend), unit: " %" } : null;

  const funnel = toFunnel(curSums);
  const cacLevers = hasPrev ? buildCacLevers(cur, prev) : null;
  const prevForDiagnose = hasPrev ? { funnel: toFunnel(prevSums), ventes: [{ k: "deal", v: prev.deal }] } : null;

  return { ventes, acq, funnel, cacLevers, prevForDiagnose, hasPrev };
}

function bucketTrend(daily, start, end) {
  const s = toEpochDay(start), e = toEpochDay(end);
  const lenDays = e - s + 1;
  const mode = lenDays <= 31 ? "day" : lenDays <= 120 ? "week" : "month";
  const buckets = new Map();
  for (const row of daily) {
    const t = toEpochDay(row.d);
    if (t < s || t > e) continue;
    let key;
    if (mode === "day") key = row.d;
    else if (mode === "week") key = mondayOf(row.d);
    else key = row.d.slice(0, 7);
    buckets.set(key, (buckets.get(key) || 0) + (row.won_value || 0));
  }
  const keys = [...buckets.keys()].sort();
  return keys.map((k) => ({
    label: mode === "month" ? k : fmtDateShort(k),
    value: Math.round(buckets.get(k)),
  }));
}

/* ============================================================
   DÉMO (fallback) — série journalière synthétique pour que le sélecteur de
   plages ait quelque chose à afficher même sans daily.json.
   ============================================================ */
function genDemoDaily() {
  const out = [];
  const today = todayInTZ();
  for (let i = 219; i >= 0; i--) {
    const d = addDays(today, -i);
    const seasonal = 1 + 0.35 * Math.sin(i / 18);
    const leads = Math.max(0, Math.round(8 * seasonal + (i % 5 === 0 ? 4 : 0)));
    const contacted = Math.round(leads * 0.55);
    const rdv = Math.round(leads * 0.5);
    const visits = Math.round(rdv * 0.85);
    const quotes = Math.round(visits * 0.9);
    const closings = Math.round(quotes * (i % 7 === 0 ? 0.55 : 0.32));
    const won_value = closings * (2300 + (i % 6) * 60);
    const spend = Math.round(leads * (20 + (i % 4)));
    out.push({ d, leads, contacted, rdv, visits, quotes, closings, won_value, spend });
  }
  return out;
}
const DEMO_DAILY = genDemoDaily();

const DEMO = {
  source: "demo", generated_at: null,
  labor_trend: [
    { m: "Mar", pct: 51 }, { m: "Avr", pct: 52 }, { m: "Mai", pct: 49 },
    { m: "Juin", pct: 48 }, { m: "Juil", pct: 47 }, { m: "Aoû", pct: 46 },
  ],
  season: [
    { m: "Jan", ca: 18 }, { m: "Fév", ca: 16 }, { m: "Mar", ca: 22 },
    { m: "Avr", ca: 55 }, { m: "Mai", ca: 98 }, { m: "Juin", ca: 92 },
    { m: "Juil", ca: 48 }, { m: "Aoû", ca: 71 }, { m: "Sep", ca: 76 },
    { m: "Oct", ca: 52 }, { m: "Nov", ca: 24 }, { m: "Déc", ca: 19 },
  ],
  rent: [
    { k: "labor", label: "Main-d'œuvre / CA", v: 46, disp: "46 %", target: 35, dir: "down", targetLabel: "30–35 %", streak: 6, sub: "le nerf de la guerre" },
    { k: "rework", label: "Taux de reprise", v: 6.8, disp: "6,8 %", target: 4, dir: "down", targetLabel: "≤ 4 %", streak: 4 },
    { k: "marge", label: "Marge brute", v: 34, disp: "34 %", target: 40, dir: "up", targetLabel: "≥ 40 %", streak: 3 },
    { k: "rpp", label: "Revenu / personne / jour", v: 1180, disp: "1 180 $", target: 1400, dir: "up", targetLabel: "≥ 1 400 $", streak: 3 },
  ],
  fbads: null,
};

const TONE = {
  fix: { c: C.red, Icon: AlertOctagon, label: "Problème" },
  push: { c: C.teal, Icon: ArrowUpRight, label: "Prochaine étape" },
  watch: { c: C.amber, Icon: AlertTriangle, label: "À surveiller" },
};

/* FB Ads : type de reco -> tonalité visuelle réutilisée du moteur de conseils */
const FBADS_TONE = {
  couper: "fix",
  scaler: "push",
  fatigue: "watch",
  angle: "push",
  diversite: "watch",
};
const FBADS_LABEL = {
  couper: "Couper",
  scaler: "Scaler",
  fatigue: "Fatigue créative",
  angle: "Angle gagnant",
  diversite: "Diversité",
};

/* ---------- UI ---------- */
function Dot({ status }) {
  return <span style={{ width: 8, height: 8, borderRadius: 99, background: STATUS[status].c, display: "inline-block" }} />;
}

function DeltaBadge({ delta, dir }) {
  if (!delta || delta.value == null) return <span className="text-[11px]" style={{ color: C.muted }}>vs préc. —</span>;
  const { value, unit } = delta;
  const isFlat = value === 0;
  const isGood = dir === "down" ? value < 0 : value > 0;
  const c = isFlat ? C.muted : isGood ? C.teal : C.red;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Activity;
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: c }}>
      <Icon size={11} />{value > 0 ? "+" : ""}{value}{unit}
      <span style={{ color: C.line }}>· vs préc.</span>
    </span>
  );
}

function KpiCard({ kpi }) {
  const st = statusOf(kpi.v, kpi.target, kpi.dir);
  const { c, Icon: SIcon } = STATUS[st];
  const Kicon = ICONS[kpi.k] || Activity;
  const Trend = kpi.dir === "up" ? TrendingUp : TrendingDown;
  const tooHot = kpi.k === "close" && kpi.v > CLOSE_CEIL;
  return (
    <div className="rounded-lg p-4" style={{ background: C.panel2, border: `1px solid ${tooHot ? C.amber : C.line}` }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2" style={{ color: C.muted }}>
          <Kicon size={15} /><span className="text-xs">{kpi.label}</span>
        </div>
        {kpi.target != null && (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: tooHot ? C.amber : c, background: `${tooHot ? C.amber : c}1A` }}>
            {tooHot ? <Flame size={11} /> : <SIcon size={11} />}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-2xl font-semibold tracking-tight" style={{ color: C.text }}>{kpi.disp}</span>
      </div>
      {kpi.target != null ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: C.muted }}>
          <Trend size={12} style={{ color: c }} />
          <span>cible {kpi.targetLabel}</span>
          {kpi.sub && <span style={{ color: C.line }}>·</span>}
          {kpi.sub && <span className="italic">{kpi.sub}</span>}
        </div>
      ) : (
        <div className="mt-2 text-[11px]" style={{ color: C.muted }}>{kpi.sub || "contexte"}</div>
      )}
      <div className="mt-1.5"><DeltaBadge delta={kpi.delta} dir={kpi.dir || "up"} /></div>
    </div>
  );
}

function LeverTile({ name, kpis, hero }) {
  const worst = kpis.filter((k) => k.target != null)
    .map((k) => statusOf(k.v, k.target, k.dir))
    .reduce((acc, s) => (s === "bad" ? "bad" : acc === "bad" ? "bad" : s === "watch" ? "watch" : acc), "good");
  const h = kpis.find((k) => k.k === hero) || kpis[0];
  const st = statusOf(h.v, h.target, h.dir);
  const tooHot = h.k === "close" && h.v > CLOSE_CEIL;
  return (
    <div className="rounded-xl p-4 flex-1" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest" style={{ color: C.muted }}>{name}</span>
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: STATUS[worst].c }}>
          <Dot status={worst} />{STATUS[worst].label}
        </div>
      </div>
      <div className="mt-3">
        <div className="text-3xl font-bold tracking-tight" style={{ color: tooHot ? C.amber : STATUS[st].c }}>{h.disp}</div>
        <div className="text-[11px] mt-1" style={{ color: C.muted }}>{h.label}{h.targetLabel ? ` · cible ${h.targetLabel}` : ""}</div>
      </div>
    </div>
  );
}

function Funnel({ rows }) {
  const max = rows[0]?.n || 1;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const w = Math.round((r.n / max) * 100);
        const conv = i === 0 ? null : Math.round((r.n / rows[i - 1].n) * 100);
        const isLast = i === rows.length - 1;
        return (
          <div key={r.s}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span style={{ color: C.muted }}>{r.s}</span>
              <span className="flex items-center gap-2">
                {conv != null && <span style={{ color: conv < 45 && isLast ? C.amber : C.muted }}>{conv} %</span>}
                <span className="font-semibold" style={{ color: C.text }}>{r.n}</span>
              </span>
            </div>
            <div className="h-6 rounded" style={{ background: C.panel2 }}>
              <div className="h-6 rounded" style={{
                width: `${w}%`, background: isLast ? C.teal : `linear-gradient(90deg, ${C.tealDim}, ${C.teal})`,
                opacity: isLast ? 1 : 0.55 + (i * 0.09), transition: "width .5s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, right, children }) {
  return (
    <div className="rounded-xl p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium" style={{ color: C.text }}>{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function AdviceRow({ a }) {
  const t = TONE[a.tone];
  return (
    <div className="rounded-lg p-3 flex gap-3" style={{ background: C.panel2, border: `1px solid ${t.c}33` }}>
      <t.Icon size={16} style={{ color: t.c, marginTop: 2, flexShrink: 0 }} />
      <div>
        <div className="text-xs font-semibold" style={{ color: t.c }}>{a.title}</div>
        <div className="text-[12px] mt-1 leading-relaxed" style={{ color: C.muted }}>{a.text}</div>
      </div>
    </div>
  );
}

/* ============================================================
   CAC — quel levier bouge (CPL vs conversion lead→client)
   ============================================================ */
function CacLeversPanel({ levers }) {
  if (!levers) return null;
  const cplUp = levers.cpl_change_pct != null && levers.cpl_change_pct > 0;
  const convDown = levers.conversion_change_pct != null && levers.conversion_change_pct < 0;
  const fmtDelta = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v} %`);
  return (
    <Panel title="CAC — quel levier bouge ?" right={<span className="text-[11px]" style={{ color: C.muted }}>vs période précédente</span>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-[11px] flex items-center gap-1" style={{ color: C.muted }}><Megaphone size={12} /> CPL (efficacité pub)</div>
          <div className="text-lg font-semibold mt-0.5" style={{ color: cplUp ? C.red : C.teal }}>{fmtDelta(levers.cpl_change_pct)}</div>
        </div>
        <div>
          <div className="text-[11px] flex items-center gap-1" style={{ color: C.muted }}><Target size={12} /> Conversion lead→client</div>
          <div className="text-lg font-semibold mt-0.5" style={{ color: convDown ? C.red : C.teal }}>{fmtDelta(levers.conversion_change_pct)}</div>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed" style={{ color: C.muted }}>{levers.driver_text}</p>
    </Panel>
  );
}

/* ============================================================
   FB ADS — ad sets (COUPER/SCALER) + créas (FATIGUE/ANGLE/DIVERSITÉ)
   Toujours des suggestions à approuver — aucune mutation de campagne.
   Fenêtre fixe 7j vs 7j (indépendante du sélecteur de plage — nécessite des
   appels Meta au niveau ad set/créa, pas dans daily.json).
   ============================================================ */
function fmtPctVal(v) { return v == null ? "—" : `${v} %`; }

function FbAdsTable({ rows, kind }) {
  if (!rows.length) return <p className="text-xs" style={{ color: C.muted }}>Aucune donnée cette semaine.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]" style={{ borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr style={{ color: C.muted, borderBottom: `1px solid ${C.line}` }}>
            <th className="text-left py-1.5 pr-2">{kind === "adset" ? "Ad set" : "Créa"}</th>
            <th className="text-right py-1.5 px-2">Dépense</th>
            <th className="text-right py-1.5 px-2">Leads</th>
            <th className="text-right py-1.5 px-2">CPL</th>
            <th className="text-right py-1.5 px-2">CPM</th>
            <th className="text-right py-1.5 px-2">CTR</th>
            <th className="text-right py-1.5 px-2">Fréq.</th>
            <th className="text-right py-1.5 pl-2">Impr.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cplHot = r.cpl_a != null && r.cpl_a > 25;
            const cplCold = r.cpl_a != null && r.cpl_a < 17;
            const freqHot = r.freq_a != null && r.freq_a >= 2.5;
            return (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                <td className="py-1.5 pr-2" style={{ color: C.text }}>
                  {r.name}
                  {kind === "ad" && r.adset_name ? <span style={{ color: C.muted }}> · {r.adset_name}</span> : null}
                </td>
                <td className="text-right py-1.5 px-2" style={{ color: C.text }}>{money(r.spend_a)}</td>
                <td className="text-right py-1.5 px-2" style={{ color: C.text }}>{r.leads_a}</td>
                <td className="text-right py-1.5 px-2" style={{ color: cplHot ? C.red : cplCold ? C.teal : C.text }}>{money(r.cpl_a)}</td>
                <td className="text-right py-1.5 px-2" style={{ color: C.muted }}>{money(r.cpm_a)}</td>
                <td className="text-right py-1.5 px-2" style={{ color: C.muted }}>{fmtPctVal(r.ctr_a)}</td>
                <td className="text-right py-1.5 px-2" style={{ color: freqHot ? C.amber : C.muted }}>{r.freq_a}</td>
                <td className="text-right py-1.5 pl-2" style={{ color: C.muted }}>{(r.impressions_a || 0).toLocaleString("fr-CA")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FbAdsSection({ fbads }) {
  if (!fbads) return null;
  const recos = fbads.recommendations || [];
  const adsets = fbads.adsets || [];
  const ads = [...(fbads.ads || [])].sort((a, b) => b.spend_a - a.spend_a);

  return (
    <div className="mt-3 space-y-3">
      <Panel
        title="FB Ads — recommandations (à approuver, rien n'est automatique)"
        right={fbads.window_current ? (
          <span className="text-[11px]" style={{ color: C.muted }}>
            {fbads.window_current.since} → {fbads.window_current.until}
          </span>
        ) : null}
      >
        {recos.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {recos.map((r, i) => (
              <AdviceRow key={i} a={{
                tone: FBADS_TONE[r.type] || "watch",
                title: `[${FBADS_LABEL[r.type] || r.type}] ${r.title}`,
                text: r.text,
              }} />
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: C.muted }}>Aucune recommandation cette semaine — rien qui dépasse les seuils (CPL &gt; 25 $, fréquence &gt; 2,5, etc.).</p>
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title={`Par ad set (${adsets.length})`}>
          <FbAdsTable rows={adsets} kind="adset" />
        </Panel>
        <Panel title={`Par créa — top dépense (${Math.min(ads.length, 10)}/${ads.length})`}>
          <FbAdsTable rows={ads.slice(0, 10)} kind="ad" />
        </Panel>
      </div>
    </div>
  );
}

/* ============================================================
   SÉLECTEUR DE PLAGE + TENDANCE
   ============================================================ */
function RangeSelector({ rangeKey, setRangeKey, customStart, setCustomStart, customEnd, setCustomEnd, todayIso }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={rangeKey}
        onChange={(e) => setRangeKey(e.target.value)}
        className="text-xs px-3 py-1.5 rounded-lg"
        style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.text }}
      >
        {RANGE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {rangeKey === "custom" && (
        <>
          <input type="date" value={customStart} max={todayIso} onChange={(e) => setCustomStart(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.text, colorScheme: "dark" }} />
          <span style={{ color: C.muted }}>→</span>
          <input type="date" value={customEnd} max={todayIso} onChange={(e) => setCustomEnd(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.text, colorScheme: "dark" }} />
        </>
      )}
    </div>
  );
}

function TrendPanel({ daily, start, end }) {
  const rows = bucketTrend(daily, start, end);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <Panel title="Historique — $ closé" right={<span className="text-[11px]" style={{ color: C.muted }}>total {money(total)} · {rows.length} points</span>}>
      {rows.length ? (
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} />
            <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <Tooltip cursor={{ fill: `${C.teal}12` }} contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.text }} labelStyle={{ color: C.muted }} formatter={(v) => [money(v), "$ closé"]} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} fill={C.teal} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs" style={{ color: C.muted }}>Pas de données closes sur cette plage.</p>
      )}
    </Panel>
  );
}

/* ---------- app ---------- */
export default function CockpitMAG() {
  const [kpis, setKpis] = useState(DEMO);
  const [daily, setDaily] = useState(DEMO_DAILY);
  const [rangeKey, setRangeKey] = useState("d7");
  const todayIso = useMemo(() => todayInTZ(), []);
  const [customStart, setCustomStart] = useState(() => addDays(todayIso, -6));
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [showSources, setShowSources] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("./data/kpis.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("./data/daily.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([kpisJson, dailyJson]) => {
      if (!alive) return;
      if (kpisJson) setKpis(kpisJson);
      if (Array.isArray(dailyJson) && dailyJson.length) setDaily(dailyJson);
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const { start, end } = computeRange(rangeKey, todayIso, customStart, customEnd);
  const view = useMemo(() => buildPeriodView(daily, start, end), [daily, start, end]);
  const { ventes, acq, funnel, cacLevers, prevForDiagnose } = view;
  const rent = kpis.rent || DEMO.rent;

  const isLive = kpis.source === "live";
  const stamp = kpis.generated_at
    ? new Date(kpis.generated_at).toLocaleString("fr-CA", { dateStyle: "medium", timeStyle: "short" })
    : null;

  const P = { ventes, funnel };
  const diag = diagnose(P, prevForDiagnose);
  const advices = [...ventes, ...acq, ...rent].map(adviceFor).filter(Boolean);
  const fixes = advices.filter((a) => a.tone === "fix");
  const pushes = advices.filter((a) => a.tone === "push");
  const watches = advices.filter((a) => a.tone === "watch");

  const prevRange = previousEquivalent(start, end);

  return (
    <div className="min-h-screen w-full" style={{ background: C.ink, color: C.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ width: 10, height: 10, background: C.teal, borderRadius: 2, display: "inline-block" }} />
              <h1 className="text-lg font-semibold tracking-tight">MAG · Cockpit KPI</h1>
              {isLive ? (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ color: C.teal, background: `${C.teal}1A` }}><Wifi size={11} /> en direct</span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ color: C.amber, background: `${C.amber}1A` }}><WifiOff size={11} /> {loading ? "chargement…" : "données démo"}</span>
              )}
            </div>
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              État de santé + diagnostic — Ventes · Acquisition · Rentabilité{stamp && <span> · maj {stamp}</span>}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: C.line }}>
              {fmtDateShort(start)} → {fmtDateShort(end)} · vs {fmtDateShort(prevRange.start)} → {fmtDateShort(prevRange.end)}
            </p>
          </div>
          <RangeSelector
            rangeKey={rangeKey} setRangeKey={setRangeKey}
            customStart={customStart} setCustomStart={setCustomStart}
            customEnd={customEnd} setCustomEnd={setCustomEnd}
            todayIso={todayIso}
          />
        </div>

        {/* DIAGNOSTIC — priorité */}
        <div className="rounded-xl p-4 mb-6 flex gap-3" style={{ background: `${TONE[diag.tone].c}12`, border: `1px solid ${TONE[diag.tone].c}55` }}>
          <Compass size={20} style={{ color: TONE[diag.tone].c, flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: TONE[diag.tone].c }}>Diagnostic · {TONE[diag.tone].label}</div>
            <div className="text-sm font-semibold" style={{ color: C.text }}>{diag.title}</div>
            <div className="text-[12px] mt-1 leading-relaxed" style={{ color: C.muted }}>{diag.text}</div>
          </div>
        </div>

        {/* leviers */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <LeverTile name="Ventes" kpis={ventes} hero="close" />
          <LeverTile name="Acquisition" kpis={acq} hero="cpl" />
          <LeverTile name="Rentabilité" kpis={rent} hero="labor" />
        </div>

        {[["Ventes", "ventes", ventes], ["Acquisition", "acq", acq], ["Rentabilité", "rent", rent]].map(([title, key, arr]) => (
          <div className="mb-4" key={key}>
            <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: C.muted }}>{title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {arr.map((k) => <KpiCard key={k.k} kpi={k} />)}
            </div>
            {key === "acq" && (
              <>
                <div className="mt-3"><CacLeversPanel levers={cacLevers} /></div>
                <FbAdsSection fbads={kpis.fbads} />
              </>
            )}
          </div>
        ))}

        {/* CONSEILS */}
        {(fixes.length || pushes.length || watches.length) ? (
          <div className="mt-6 mb-2">
            <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: C.muted }}>Conseils</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {[...fixes, ...pushes, ...watches].map((a, i) => <AdviceRow key={i} a={a} />)}
            </div>
          </div>
        ) : null}

        {/* funnel + tendance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3 mt-6">
          <Panel title="Entonnoir SETTING → CLOSING" right={<span className="text-[11px]" style={{ color: C.muted }}>{fmtDateShort(start)} → {fmtDateShort(end)}</span>}>
            <Funnel rows={funnel} />
          </Panel>
          <TrendPanel daily={daily} start={start} end={end} />
        </div>

        {/* rentabilité — parquée */}
        <Panel title="Main-d'œuvre / CA vs cible" right={<span className="text-[11px]" style={{ color: C.red }}>cible 30–35 % · parqué</span>}>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={kpis.labor_trend || DEMO.labor_trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
              <ReferenceArea y1={30} y2={35} fill={C.teal} fillOpacity={0.14} />
              <XAxis dataKey="m" stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} />
              <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[25, 55]} unit=" %" width={44} />
              <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.text }} labelStyle={{ color: C.muted }} formatter={(v) => [`${v} %`, "Main-d'œuvre"]} />
              <Line type="monotone" dataKey="pct" stroke={C.red} strokeWidth={2.5} dot={{ r: 3, fill: C.red }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] mt-2" style={{ color: C.muted }}>Bande verte = cible 30–35 %. Section parquée — données démo tant que le module rentabilité n'est pas branché (Jobber timesheets, phase séparée).</p>
        </Panel>

        {/* saisonnalité */}
        <div className="mt-3">
          <Panel title="Saisonnalité du CA (indice mensuel)" right={<span className="text-[11px]" style={{ color: C.muted }}>pic mai–juin · creux vacances construction · mort nov.–mars</span>}>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={kpis.season || DEMO.season} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} />
                <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
                <Tooltip cursor={{ fill: `${C.teal}12` }} contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.text }} labelStyle={{ color: C.muted }} formatter={(v) => [v, "Indice CA"]} />
                <Bar dataKey="ca" radius={[3, 3, 0, 0]}>
                  {(kpis.season || DEMO.season).map((d, i) => <Cell key={i} fill={d.ca >= 70 ? C.teal : d.ca >= 40 ? C.tealDim : C.line} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        {/* sources */}
        <button onClick={() => setShowSources((s) => !s)} className="mt-4 flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
          <ChevronDown size={14} style={{ transform: showSources ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          D'où viennent les chiffres
        </button>
        {showSources && (
          <div className="mt-3 rounded-lg p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.muted }}>
            <div><div className="font-medium mb-1" style={{ color: C.teal }}>Ventes</div>Série journalière (docs/data/daily.json) agrégée sur la plage choisie : GHL (leads, RDV, visites, closings) + Jobber quotes (soumissions, lecture seule). Le front somme les comptes bruts puis divise — jamais de moyenne de taux.</div>
            <div><div className="font-medium mb-1" style={{ color: C.teal }}>Acquisition</div>CPL / CPS / dépense / leads → dépense Meta journalière ÷ compte GHL, sur la même plage. FB Ads (ad set/créa) → fenêtre fixe 7j vs 7j, Meta Ads API. CAC → dépense Meta ÷ nouveaux clients GHL.</div>
            <div><div className="font-medium mb-1" style={{ color: C.teal }}>Rentabilité</div>Parquée cette phase-ci — données démo. Main-d'œuvre → timesheets Jobber × taux chargé (module séparé, à venir).</div>
          </div>
        )}

        <p className="text-[10px] mt-6 flex items-center gap-1" style={{ color: C.line }}>
          <RefreshCw size={10} />{isLive ? "Alimenté par build_kpis.py (GitHub Actions)." : "Mode démo — chiffres illustratifs."}
        </p>
      </div>
    </div>
  );
}
