import { useState, useEffect } from "react";
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
   - Lit docs/data/kpis.json (build_kpis.py). Sinon -> démo.
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

const STATUS = {
  good: { c: C.teal, label: "sur la cible", Icon: Check },
  watch: { c: C.amber, label: "à surveiller", Icon: AlertTriangle },
  bad: { c: C.red, label: "hors cible", Icon: X },
  none: { c: C.muted, label: "", Icon: Activity },
};

const ICONS = {
  contact: Phone, rdv: CalendarCheck, close: Target, deal: DollarSign,
  cpl: Megaphone, cac: Target, leads: Users, spend: DollarSign,
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
        text: `Closing stable dans la zone ${CLOSE_FLOOR}–${CLOSE_CEIL} % depuis ${streak} périodes. Prochaine étape : pousse le panier moyen (upsells relevelage / sable premium / murets) plutôt que le taux.` };
    return null;
  }
  if (k === "deal") {
    if (st === "bad") return { tone: "fix", title: "Panier moyen bas",
      text: `Sous 2 400 $. Systématise les upsells (relevelage, sable premium, murets) et respecte ton minimum de job. Un bundle proposé par défaut monte le panier sans baisser le closing.` };
    if (st === "good" && streak >= 3) return { tone: "push", title: "Panier solide — teste plus haut",
      text: `Panier au-dessus de la cible depuis ${streak} périodes. Teste un tier de prix plus élevé sur les grosses surfaces / gros joints et regarde si le closing tient.` };
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
      text: "Une fois branché sur l'historique, ce panneau te dira exactement d'où vient une baisse de $ closé." };
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

  const idx = stages.indexOf(culprit);
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
  return `${Math.round(v).toLocaleString("fr-CA")} $`.replace(/ |,/g, " ");
}

/* ============================================================
   DÉMO (fallback) — cible closing 35 %
   ============================================================ */
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
  periods: {
    current: {
      label: "Août 2026",
      ventes: [
        { k: "contact", label: "Contact jour-même", v: 68, disp: "68 %", target: 80, dir: "up", targetLabel: "≥ 80 %", streak: 2 },
        { k: "rdv", label: "Taux de RDV booké", v: 55, disp: "55 %", target: 60, dir: "up", targetLabel: "≥ 60 %", streak: 2 },
        { k: "close", label: "Taux de closing", v: 47, disp: "47 %", target: 35, dir: "up", targetLabel: "35–45 %", streak: 4, sub: "au-dessus de 45 %" },
        { k: "deal", label: "Valeur moyenne / deal", v: 2540, disp: "2 540 $", target: 2400, dir: "up", targetLabel: "≥ 2 400 $", streak: 5 },
      ],
      acq: [
        { k: "cpl", label: "Coût par lead", v: 23, disp: "23 $", target: 21, dir: "down", targetLabel: "17–21 $", streak: 2 },
        { k: "cac", label: "Coût d'acquisition client", v: 310, disp: "310 $", target: 350, dir: "down", targetLabel: "≤ 350 $", streak: 3 },
        { k: "leads", label: "Leads générés", v: 183, disp: "183", target: null, sub: "Meta 70 % · Google 30 %" },
        { k: "spend", label: "Dépense pub", v: 4200, disp: "4 200 $", target: null },
      ],
      rent: [
        { k: "labor", label: "Main-d'œuvre / CA", v: 46, disp: "46 %", target: 35, dir: "down", targetLabel: "30–35 %", streak: 6, sub: "le nerf de la guerre" },
        { k: "rework", label: "Taux de reprise", v: 6.8, disp: "6,8 %", target: 4, dir: "down", targetLabel: "≤ 4 %", streak: 4 },
        { k: "marge", label: "Marge brute", v: 34, disp: "34 %", target: 40, dir: "up", targetLabel: "≥ 40 %", streak: 3 },
        { k: "rpp", label: "Revenu / personne / jour", v: 1180, disp: "1 180 $", target: 1400, dir: "up", targetLabel: "≥ 1 400 $", streak: 3 },
      ],
      funnel: [
        { s: "Leads", n: 183 }, { s: "Contactés jour-même", n: 124 },
        { s: "RDV bookés", n: 68 }, { s: "Visites réalisées", n: 51 },
        { s: "Soumissions envoyées", n: 51 }, { s: "Closings", n: 24 },
      ],
    },
    previous: {
      label: "Juillet 2026",
      ventes: [
        { k: "contact", label: "Contact jour-même", v: 62, disp: "62 %", target: 80, dir: "up", targetLabel: "≥ 80 %", streak: 1 },
        { k: "rdv", label: "Taux de RDV booké", v: 53, disp: "53 %", target: 60, dir: "up", targetLabel: "≥ 60 %", streak: 1 },
        { k: "close", label: "Taux de closing", v: 32, disp: "32 %", target: 35, dir: "up", targetLabel: "35–45 %", streak: 1, sub: "creux vacances construction" },
        { k: "deal", label: "Valeur moyenne / deal", v: 2380, disp: "2 380 $", target: 2400, dir: "up", targetLabel: "≥ 2 400 $", streak: 1 },
      ],
      acq: [
        { k: "cpl", label: "Coût par lead", v: 26, disp: "26 $", target: 21, dir: "down", targetLabel: "17–21 $", streak: 2 },
        { k: "cac", label: "Coût d'acquisition client", v: 395, disp: "395 $", target: 350, dir: "down", targetLabel: "≤ 350 $", streak: 2 },
        { k: "leads", label: "Leads générés", v: 141, disp: "141", target: null, sub: "Meta 72 % · Google 28 %" },
        { k: "spend", label: "Dépense pub", v: 3700, disp: "3 700 $", target: null },
      ],
      rent: [
        { k: "labor", label: "Main-d'œuvre / CA", v: 47, disp: "47 %", target: 35, dir: "down", targetLabel: "30–35 %", streak: 5, sub: "le nerf de la guerre" },
        { k: "rework", label: "Taux de reprise", v: 7.1, disp: "7,1 %", target: 4, dir: "down", targetLabel: "≤ 4 %", streak: 3 },
        { k: "marge", label: "Marge brute", v: 32, disp: "32 %", target: 40, dir: "up", targetLabel: "≥ 40 %", streak: 2 },
        { k: "rpp", label: "Revenu / personne / jour", v: 1050, disp: "1 050 $", target: 1400, dir: "up", targetLabel: "≥ 1 400 $", streak: 2 },
      ],
      funnel: [
        { s: "Leads", n: 141 }, { s: "Contactés jour-même", n: 88 },
        { s: "RDV bookés", n: 47 }, { s: "Visites réalisées", n: 34 },
        { s: "Soumissions envoyées", n: 34 }, { s: "Closings", n: 11 },
      ],
    },
    t3m: {
      label: "3 derniers mois",
      ventes: [
        { k: "contact", label: "Contact jour-même", v: 66, disp: "66 %", target: 80, dir: "up", targetLabel: "≥ 80 %" },
        { k: "rdv", label: "Taux de RDV booké", v: 54, disp: "54 %", target: 60, dir: "up", targetLabel: "≥ 60 %" },
        { k: "close", label: "Taux de closing", v: 41, disp: "41 %", target: 35, dir: "up", targetLabel: "35–45 %", sub: "zone saine" },
        { k: "deal", label: "Valeur moyenne / deal", v: 2470, disp: "2 470 $", target: 2400, dir: "up", targetLabel: "≥ 2 400 $" },
      ],
      acq: [
        { k: "cpl", label: "Coût par lead", v: 24, disp: "24 $", target: 21, dir: "down", targetLabel: "17–21 $" },
        { k: "cac", label: "Coût d'acquisition client", v: 355, disp: "355 $", target: 350, dir: "down", targetLabel: "≤ 350 $" },
        { k: "leads", label: "Leads générés", v: 512, disp: "512", target: null, sub: "Meta 71 % · Google 29 %" },
        { k: "spend", label: "Dépense pub", v: 12300, disp: "12 300 $", target: null },
      ],
      rent: [
        { k: "labor", label: "Main-d'œuvre / CA", v: 47, disp: "47 %", target: 35, dir: "down", targetLabel: "30–35 %", sub: "le nerf de la guerre" },
        { k: "rework", label: "Taux de reprise", v: 6.8, disp: "6,8 %", target: 4, dir: "down", targetLabel: "≤ 4 %" },
        { k: "marge", label: "Marge brute", v: 33, disp: "33 %", target: 40, dir: "up", targetLabel: "≥ 40 %" },
        { k: "rpp", label: "Revenu / personne / jour", v: 1110, disp: "1 110 $", target: 1400, dir: "up", targetLabel: "≥ 1 400 $" },
      ],
      funnel: [
        { s: "Leads", n: 512 }, { s: "Contactés jour-même", n: 336 },
        { s: "RDV bookés", n: 190 }, { s: "Visites réalisées", n: 141 },
        { s: "Soumissions envoyées", n: 141 }, { s: "Closings", n: 58 },
      ],
    },
  },
};

const ORDER = ["current", "previous", "t3m"];
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
    <Panel title="CAC — quel levier bouge ?" right={<span className="text-[11px]" style={{ color: C.muted }}>vs semaine précédente</span>}>
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

/* ---------- app ---------- */
export default function CockpitMAG() {
  const [data, setData] = useState(DEMO);
  const [pk, setPk] = useState("current");
  const [showSources, setShowSources] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("./data/kpis.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => { if (alive && json?.periods) { setData(json); setPk(ORDER.find((k) => json.periods[k]) || Object.keys(json.periods)[0]); } })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const periodKeys = ORDER.filter((k) => data.periods[k]);
  const P = data.periods[pk] || data.periods[periodKeys[0]];
  const prevKey = pk === "current" ? "previous" : null;
  const prev = prevKey ? data.periods[prevKey] : null;
  const isLive = data.source === "live";
  const stamp = data.generated_at
    ? new Date(data.generated_at).toLocaleString("fr-CA", { dateStyle: "medium", timeStyle: "short" })
    : null;

  const diag = diagnose(P, prev);
  const advices = [...P.ventes, ...P.acq, ...P.rent].map(adviceFor).filter(Boolean);
  const fixes = advices.filter((a) => a.tone === "fix");
  const pushes = advices.filter((a) => a.tone === "push");
  const watches = advices.filter((a) => a.tone === "watch");

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
          </div>
          <div className="flex gap-1 rounded-lg p-1" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            {periodKeys.map((key) => (
              <button key={key} onClick={() => setPk(key)} className="text-xs px-3 py-1.5 rounded-md transition-colors"
                style={{ background: pk === key ? C.teal : "transparent", color: pk === key ? C.ink : C.muted, fontWeight: pk === key ? 600 : 400 }}>
                {data.periods[key].label}
              </button>
            ))}
          </div>
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
          <LeverTile name="Ventes" kpis={P.ventes} hero="close" />
          <LeverTile name="Acquisition" kpis={P.acq} hero="cpl" />
          <LeverTile name="Rentabilité" kpis={P.rent} hero="labor" />
        </div>

        {[["Ventes", "ventes"], ["Acquisition", "acq"], ["Rentabilité", "rent"]].map(([title, key]) => (
          <div className="mb-4" key={key}>
            <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: C.muted }}>{title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {P[key].map((k) => <KpiCard key={k.k} kpi={k} />)}
            </div>
            {key === "acq" && (
              <>
                <div className="mt-3"><CacLeversPanel levers={P.cac_levers} /></div>
                <FbAdsSection fbads={data.fbads} />
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

        {/* funnel + main-d'œuvre */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3 mt-6">
          <Panel title="Entonnoir SETTING → CLOSING" right={<span className="text-[11px]" style={{ color: C.muted }}>{P.label}</span>}>
            <Funnel rows={P.funnel} />
          </Panel>
          <Panel title="Main-d'œuvre / CA vs cible" right={<span className="text-[11px]" style={{ color: C.red }}>cible 30–35 %</span>}>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={data.labor_trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
                <ReferenceArea y1={30} y2={35} fill={C.teal} fillOpacity={0.14} />
                <XAxis dataKey="m" stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} />
                <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[25, 55]} unit=" %" width={44} />
                <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.text }} labelStyle={{ color: C.muted }} formatter={(v) => [`${v} %`, "Main-d'œuvre"]} />
                <Line type="monotone" dataKey="pct" stroke={C.red} strokeWidth={2.5} dot={{ r: 3, fill: C.red }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[11px] mt-2" style={{ color: C.muted }}>Bande verte = cible 30–35 %. Chaque point au-dessus, c'est de la marge qui dort. Section parquée — données démo tant que le module rentabilité n'est pas branché.</p>
          </Panel>
        </div>

        {/* saisonnalité */}
        <Panel title="Saisonnalité du CA (indice mensuel)" right={<span className="text-[11px]" style={{ color: C.muted }}>pic mai–juin · creux vacances construction · mort nov.–mars</span>}>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data.season} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="m" stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} />
              <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
              <Tooltip cursor={{ fill: `${C.teal}12` }} contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.text }} labelStyle={{ color: C.muted }} formatter={(v) => [v, "Indice CA"]} />
              <Bar dataKey="ca" radius={[3, 3, 0, 0]}>
                {data.season.map((d, i) => <Cell key={i} fill={d.ca >= 70 ? C.teal : d.ca >= 40 ? C.tealDim : C.line} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* sources */}
        <button onClick={() => setShowSources((s) => !s)} className="mt-4 flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
          <ChevronDown size={14} style={{ transform: showSources ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          D'où viennent les chiffres
        </button>
        {showSources && (
          <div className="mt-3 rounded-lg p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.muted }}>
            <div><div className="font-medium mb-1" style={{ color: C.teal }}>Ventes</div>Funnel + closing → opportunités GHL (statut won/lost). Visites/soumissions → calendrier GHL + quotes Jobber (lecture seule). Valeur / deal → monetaryValue GHL.</div>
            <div><div className="font-medium mb-1" style={{ color: C.teal }}>Acquisition</div>CPL / dépense / leads / FB Ads → Meta Ads API (ad set + créa, 2 fenêtres). CAC → dépense Meta ÷ nouveaux clients GHL.</div>
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
