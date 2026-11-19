// MieloFarma · motor determinista de cálculo (sin dependencias de interfaz ni de red)
export const ENGINE_VERSION = "1.0.0";
export const DAYS_PER_MONTH = 30.4375;

/* ---------- Superficie corporal ---------- */
export const BSA_METHODS = {
  mosteller: { label: "Mosteller", formula: "√(talla[cm] × peso[kg] / 3600)" },
  dubois: { label: "Du Bois", formula: "0,007184 × peso^0,425 × talla[cm]^0,725" },
  haycock: { label: "Haycock", formula: "0,024265 × peso^0,5378 × talla[cm]^0,3964" },
};

export function validatePatient(weight, heightM) {
  const errs = [];
  if (!(weight > 0)) errs.push("Peso: indica un valor mayor que 0 (kg).");
  else if (weight < 25 || weight > 250) errs.push("Peso fuera de rango plausible (25–250 kg). Revisa unidades.");
  if (!(heightM > 0)) errs.push("Talla: indica un valor mayor que 0 (m).");
  else if (heightM < 1 || heightM > 2.3) errs.push("Talla fuera de rango plausible (1,00–2,30 m). La talla se introduce en metros.");
  return errs;
}

export function bsa(method, weight, heightM) {
  if (validatePatient(weight, heightM).length) return null;
  const h = heightM * 100;
  let v;
  if (method === "dubois") v = 0.007184 * Math.pow(weight, 0.425) * Math.pow(h, 0.725);
  else if (method === "haycock") v = 0.024265 * Math.pow(weight, 0.5378) * Math.pow(h, 0.3964);
  else v = Math.sqrt((h * weight) / 3600);
  return v;
}

export function resolvePatient(p) {
  const errors = validatePatient(p.weight, p.height);
  let sc = null, scSource = "";
  if (p.scOverride > 0) { sc = p.scOverride; scSource = "valor fijado manualmente"; }
  else if (!errors.length) { sc = bsa(p.scMethod || "mosteller", p.weight, p.height); scSource = BSA_METHODS[p.scMethod || "mosteller"].label; }
  return { weight: p.weight, height: p.height, sc, scSource, errors };
}

/* ---------- Catálogo y presentaciones ---------- */
export function currentPrice(entry, asOf) {
  if (!entry.history || !entry.history.length) return null;
  const list = entry.history.filter((h) => !asOf || !h.from || h.from <= asOf).sort((a, b) => (a.from || "").localeCompare(b.from || ""));
  const last = list[list.length - 1] || entry.history[entry.history.length - 1];
  return last && last.price > 0 ? last.price : null;
}

export function presentationsFor(catalog, drug, priceFactor = 1, asOf) {
  return catalog
    .filter((c) => c.drug === drug && !c.archived && c.mg > 0 && currentPrice(c, asOf) != null)
    .map((c) => ({ id: c.id, label: c.label, mg: c.mg, price: currentPrice(c, asOf) * priceFactor, oral: !!c.oral, unit: c.unit }));
}

// Cobertura mínima con envases completos (sin fraccionar)
export function minCover(doseMg, pres) {
  if (!(doseMg > 0) || !pres.length) return null;
  let best = null;
  const caps = pres.map((p) => Math.ceil(doseMg / p.mg - 1e-9));
  const counts = new Array(pres.length).fill(0);
  (function rec(i, mg, cost) {
    if (i === pres.length) {
      if (mg + 1e-9 >= doseMg) {
        if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && mg < best.mg)) best = { cost, mg, counts: counts.slice() };
      }
      return;
    }
    for (let n = 0; n <= caps[i]; n++) {
      counts[i] = n;
      rec(i + 1, mg + n * pres[i].mg, cost + n * pres[i].price);
    }
    counts[i] = 0;
  })(0, 0, 0);
  if (!best) return null;
  return { items: pres.map((p, i) => ({ pres: p, n: best.counts[i] })).filter((x) => x.n > 0), mgSupplied: best.mg, cost: best.cost };
}

export function adminCost(doseMg, pres, reuse = 0) {
  const cov = minCover(doseMg, pres);
  if (!cov) return null;
  const theor = (cov.cost * doseMg) / cov.mgSupplied; // €/mg de la(s) presentación(es) elegida(s)
  const full = cov.cost;
  const parenteral = cov.items.some((i) => !i.pres.oral);
  const eff = parenteral ? theor + (full - theor) * (1 - reuse) : full;
  return { theor, full, eff, vials: cov.items.reduce((s, i) => s + i.n, 0), mgSupplied: cov.mgSupplied, items: cov.items, waste: cov.mgSupplied - doseMg };
}

export function doseMg(comp, pt, roundStep = 0) {
  let d;
  if (comp.basis === "mgkg") d = comp.dose * pt.weight;
  else if (comp.basis === "mgm2") d = comp.dose * pt.sc;
  else d = comp.dose;
  if (roundStep > 0 && comp.basis !== "fixed") d = Math.round(d / roundStep) * roundStep;
  return d;
}

/* ---------- Calendario ---------- */
export function parseDays(str) {
  const out = new Set();
  String(str).split(/[,; ]+/).filter(Boolean).forEach((t) => {
    const m = t.match(/^(\d+)-(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); }
    else if (/^\d+$/.test(t)) out.add(+t);
    else throw new Error("Día no válido: " + t);
  });
  return [...out].sort((a, b) => a - b);
}
export function daysToString(days) {
  if (!days || !days.length) return "";
  const parts = []; let s = days[0], p = days[0];
  for (let i = 1; i <= days.length; i++) {
    if (days[i] === p + 1) { p = days[i]; continue; }
    parts.push(s === p ? `${s}` : p === s + 1 ? `${s},${p}` : `${s}-${p}`);
    s = days[i]; p = days[i];
  }
  return parts.join(",");
}

export function flattenSegments(scheme, opts = {}) {
  const segs = [];
  (scheme.segs || []).forEach((s) => segs.push({ ...s, maint: false }));
  const variants = scheme.maint || [];
  const vid = opts.maint === undefined ? null : opts.maint;
  if (vid && vid !== "none") {
    const v = variants.find((x) => x.id === vid);
    if (v) v.segs.forEach((s) => segs.push({ ...s, maint: true, variant: v.id }));
  }
  return segs;
}

export function validateScheme(scheme, catalogDrugs) {
  const errs = [];
  if (!scheme.name || !scheme.name.trim()) errs.push("Falta el nombre del esquema.");
  const all = [...(scheme.segs || []), ...(scheme.maint || []).flatMap((v) => v.segs)];
  if (!all.length) errs.push("El esquema no tiene fases.");
  all.forEach((s, i) => {
    const tag = `Fase «${s.name || i + 1}»`;
    if (s.cycles !== null && !(Number.isInteger(s.cycles) && s.cycles >= 1)) errs.push(`${tag}: número de ciclos no válido.`);
    if (!(s.len >= 1)) errs.push(`${tag}: duración de ciclo no válida.`);
    (s.comps || []).forEach((c) => {
      if (c.fixed) { if (!(c.fixed.amount >= 0)) errs.push(`${tag}: importe fijo no válido.`); return; }
      if (catalogDrugs && !catalogDrugs.includes(c.drug)) errs.push(`${tag}: fármaco «${c.drug}» no existe en el catálogo.`);
      if (!(c.dose > 0)) errs.push(`${tag}: dosis de ${c.drug} debe ser > 0.`);
      if (c.days && c.days.some((d) => d < 1 || d > s.len)) errs.push(`${tag}: días de ${c.drug} fuera del ciclo (1–${s.len}).`);
      if (c.days && !c.days.length && !c.blocks && c.total == null) errs.push(`${tag}: ${c.drug} sin días de administración.`);
    });
  });
  return errs;
}

/* ---------- Cálculo de un esquema ---------- */
// opts: { weight,height,scMethod,scOverride, horizonDays | 'all' | 'cycle1', policy:'mg'|'vial', reuse(0-1), roundStep,
//         priceFactor, asOf, maint, cyclesOverride:{segId:n}, applyCaps, includeMaint }
export function computeScheme(scheme, catalog, patient, opts = {}) {
  const pt = resolvePatient(patient);
  const res = { engine: ENGINE_VERSION, scheme: scheme.id, patient: pt, warnings: [], events: [], lines: [], bySeg: [], totals: null, errors: pt.errors.slice(), cumulative: [] };
  if (pt.errors.length || !(pt.sc > 0)) return res;
  const reuse = opts.reuse || 0, roundStep = opts.roundStep || 0, pf = opts.priceFactor || 1;
  const segsRaw = flattenSegments(scheme, opts);
  const horizonOpt = opts.horizon === undefined ? "all" : opts.horizon;

  // Offsets
  let horizonDays = Infinity;
  if (horizonOpt === "cycle1") horizonDays = segsRaw[0] ? segsRaw[0].len : 0;
  else if (typeof horizonOpt === "number") horizonDays = horizonOpt;

  let offset = 0;
  const events = [];
  const missing = new Set();
  const approx = new Set();
  const segInfo = [];
  const presCache = {};
  const getPres = (drug) => (presCache[drug] = presCache[drug] || presentationsFor(catalog, drug, pf, opts.asOf));
  const costCache = {};

  for (const seg of segsRaw) {
    if (opts.includeMaint === false && seg.maint) continue;
    let cycles = seg.cycles;
    if (opts.cyclesOverride && opts.cyclesOverride[seg.id] != null) cycles = opts.cyclesOverride[seg.id];
    if (cycles === null) cycles = Number.isFinite(horizonDays) ? Math.max(0, Math.ceil((horizonDays - offset) / seg.len)) : 12;
    const segStart = offset;
    const info = { segId: seg.id, name: seg.name, phase: seg.phase, maint: !!seg.maint, cycles, len: seg.len, start: segStart, end: segStart + cycles * seg.len, theor: 0, full: 0, eff: 0, admins: 0 };
    for (const comp of seg.comps || []) {
      const key = (comp.fixed ? `fixed|${comp.fixed.label}` : `${comp.drug}|${comp.basis}|${comp.dose}`) + (seg.maint ? "|M" : "");
      let sched = []; // [{cycle, dayInCycle, abs}]
      if (comp.fixed) sched.push({ cycle: 1, d: 1, abs: segStart + 1 });
      else if (comp.total != null) {
        approx.add(`${seg.name}: ${comp.drug}`);
        const L = cycles * seg.len, n = Math.min(comp.total, Math.max(comp.total, 0));
        for (let k = 0; k < n; k++) { const abs = segStart + 1 + Math.floor((k * L) / n); const cy = Math.floor((abs - segStart - 1) / seg.len) + 1; sched.push({ cycle: cy, d: ((abs - segStart - 1) % seg.len) + 1, abs }); }
      } else {
        const blocks = comp.blocks || [[1, cycles, comp.days]];
        for (const [c1, c2, days] of blocks) {
          for (let c = c1; c <= Math.min(c2 === "end" ? cycles : c2, cycles); c++) for (const d of days) sched.push({ cycle: c, d, abs: segStart + (c - 1) * seg.len + d });
        }
      }
      for (const s of sched) {
        if (s.abs > horizonDays) continue;
        let ev = { day: s.abs, seg: seg.id, segName: seg.name, cycle: s.cycle, key, drug: comp.drug || "fixed", basis: comp.basis, doseRef: comp.dose, maint: !!seg.maint };
        if (comp.fixed) {
          ev.label = comp.fixed.label; ev.dose = null; ev.theor = ev.full = ev.eff = comp.fixed.amount * pf; ev.vials = 0; ev.fixed = true;
        } else {
          const dm = doseMg(comp, pt, roundStep);
          ev.dose = dm;
          const ck = comp.drug + "|" + dm.toFixed(4);
          if (!(ck in costCache)) costCache[ck] = adminCost(dm, getPres(comp.drug), reuse);
          const c = costCache[ck];
          if (!c) { missing.add(comp.drug); ev.theor = ev.full = ev.eff = null; ev.vials = 0; }
          else { ev.theor = c.theor; ev.full = c.full; ev.eff = c.eff; ev.vials = c.vials; ev.waste = c.waste; ev.pack = c.items.map((i) => `${i.n}×${i.pres.label}`).join(" + "); }
        }
        events.push(ev);
      }
    }
    segInfo.push(info);
    offset = info.end;
  }

  // Topes de financiación (histórico, opcional)
  if (opts.applyCaps && scheme.caps) {
    for (const cap of scheme.caps) {
      const byYear = {};
      events.filter((e) => e.drug === cap.drug && e.eff != null).sort((a, b) => a.day - b.day).forEach((e) => {
        const y = Math.floor((e.day - 1) / 365);
        const used = byYear[y] || 0;
        const room = Math.max(0, cap.perYear - used);
        const f = e.eff > 0 ? Math.min(1, room / e.eff) : 1;
        byYear[y] = used + e.eff * f;
        e.theor *= f; e.full *= f; e.eff *= f; e.capped = true;
      });
    }
  }

  events.sort((a, b) => a.day - b.day);
  // Agregados
  const lines = {};
  for (const e of events) {
    const L = (lines[e.key] = lines[e.key] || { key: e.key, drug: e.drug, basis: e.basis, dose: e.doseRef, label: e.label || null, admins: 0, totalMg: 0, theor: 0, full: 0, eff: 0, vials: 0, waste: 0, priced: true, sampleDose: e.dose, sampleDoseMax: e.dose, pack: e.pack, maint: e.maint, segs: new Set() });
    L.admins++; L.vials += e.vials || 0; L.segs.add(e.segName);
    if (e.dose != null) { L.totalMg += e.dose; L.waste += e.waste || 0; }
    if (e.theor == null) L.priced = false; else { L.theor += e.theor; L.full += e.full; L.eff += e.eff; }
    const si = segInfo.find((s) => s.segId === e.seg);
    if (si && e.theor != null) { si.theor += e.theor; si.full += e.full; si.eff += e.eff; }
    if (si) si.admins++;
  }
  const lineArr = Object.values(lines).map((l) => ({ ...l, segs: [...l.segs] }));
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const mainLines = lineArr.filter((l) => !l.maint);
  res.events = events; res.lines = lineArr; res.bySeg = segInfo;
  res.totals = { theor: sum(lineArr, "theor"), full: sum(lineArr, "full"), eff: sum(lineArr, "eff"), admins: events.length, vials: sum(lineArr, "vials"),
    mainTheor: sum(mainLines, "theor"), mainFull: sum(mainLines, "full"), mainEff: sum(mainLines, "eff"),
    maintTheor: sum(lineArr.filter((l) => l.maint), "theor"), maintFull: sum(lineArr.filter((l) => l.maint), "full"), maintEff: sum(lineArr.filter((l) => l.maint), "eff") };
  res.durationDays = offset;
  res.horizonDays = Number.isFinite(horizonDays) ? Math.min(horizonDays, offset) : offset;
  // acumulado por día de evento
  let acc = 0;
  res.cumulative = events.map((e) => ({ day: e.day, v: (acc += e.eff || 0) }));
  // avisos
  if (missing.size) res.warnings.push({ level: "crit", code: "SIN_PRECIO", text: `Sin precio en catálogo: ${[...missing].join(", ")}. Su coste NO está incluido en el total.`, drugs: [...missing] });
  if (approx.size) res.warnings.push({ level: "warn", code: "CAL_APROX", text: `Calendario aproximado (el Excel solo indica el número total de administraciones): ${[...approx].join("; ")}. El coste no se ve afectado; las fechas sí.` });
  if (Number.isFinite(horizonDays) && horizonDays < offset) res.warnings.push({ level: "info", code: "HORIZONTE", text: `El horizonte (${Math.round(horizonDays)} d) acorta el esquema completo (${offset} d); se cuentan solo las administraciones hasta ese día.` });
  return res;
}

/* ---------- Sensibilidad ---------- */
export function sensitivity(scheme, catalog, patient, opts, metric = "eff") {
  const pick = (r) => r.totals[metric];
  const base = computeScheme(scheme, catalog, patient, opts);
  const b = pick(base);
  const sc0 = base.patient.sc;
  const rows = [];
  const add = (label, group, r) => { if (!r.totals) return; const v = pick(r); rows.push({ label, group, value: v, diff: v - b, pct: b ? ((v - b) / b) * 100 : 0 }); };
  [-0.1, 0.1].forEach((f) => add(`Peso ${f > 0 ? "+" : ""}${f * 100}% (${(patient.weight * (1 + f)).toFixed(1)} kg)`, "Peso", computeScheme(scheme, catalog, { ...patient, weight: patient.weight * (1 + f), scOverride: patient.scOverride > 0 ? patient.scOverride : 0 }, opts)));
  [-0.1, 0.1].forEach((f) => add(`SC ${f > 0 ? "+" : ""}${f * 100}% (${(sc0 * (1 + f)).toFixed(2)} m²)`, "Superficie corporal", computeScheme(scheme, catalog, { ...patient, scOverride: sc0 * (1 + f) }, opts)));
  [-0.1, 0.1].forEach((f) => add(`Precios unitarios ${f > 0 ? "+" : ""}${f * 100}%`, "Precios", computeScheme(scheme, catalog, patient, { ...opts, priceFactor: (opts.priceFactor || 1) * (1 + f) })));
  const segs = flattenSegments(scheme, opts).filter((s) => !s.maint && s.cycles);
  if (segs.length) {
    const last = segs[segs.length - 1];
    [-1, 1].forEach((d) => { const n = last.cycles + d; if (n >= 1) add(`Ciclos de «${last.name}» ${d > 0 ? "+1" : "−1"} (${n})`, "Ciclos", computeScheme(scheme, catalog, patient, { ...opts, cyclesOverride: { ...(opts.cyclesOverride || {}), [last.id]: n } })); });
  }
  if (metric === "eff") {
    add("Envases completos, sin aprovechamiento", "Presentaciones", computeScheme(scheme, catalog, patient, { ...opts, reuse: 0 }));
    add("Aprovechamiento de viales 100 %", "Presentaciones", computeScheme(scheme, catalog, patient, { ...opts, reuse: 1 }));
  }
  return { base: b, rows };
}

/* ---------- Comparación ---------- */
export function compareSchemes(list, catalog, patient, opts) {
  // list: [{scheme, maint, label}]
  const results = list.map((it) => ({ it, r: computeScheme(it.scheme, catalog, patient, { ...opts, maint: it.maint }) }));
  const drugs = [];
  results.forEach(({ r }) => r.lines.forEach((l) => { const k = l.drug; if (!drugs.includes(k)) drugs.push(k); }));
  const byDrug = drugs.map((d) => ({ drug: d, vals: results.map(({ r }) => { const ls = r.lines.filter((l) => l.drug === d); return { theor: ls.reduce((s, l) => s + l.theor, 0), full: ls.reduce((s, l) => s + l.full, 0), eff: ls.reduce((s, l) => s + l.eff, 0), admins: ls.reduce((s, l) => s + l.admins, 0), mg: ls.reduce((s, l) => s + l.totalMg, 0), priced: ls.every((l) => l.priced) }; }) }));
  return { results, byDrug };
}

/* ---------- Terapias biespecíficas (step-up configurable) ---------- */
// cfg: { drug, stepUp:[{day,dose,basis}], weekly:{dose,basis,weeks}, biweekly:{dose,basis,doses}|null }
export function buildBsAbScheme(cfg) {
  const segs = [];
  const su = cfg.stepUp.map((s) => ({ drug: cfg.drug, basis: s.basis, dose: s.dose, days: [s.day] }));
  const stepLen = Math.max(7, ...cfg.stepUp.map((s) => s.day));
  segs.push({ id: "su", name: "Step-up", phase: "induccion", cycles: 1, len: stepLen > 7 ? 14 : 7, comps: su });
  if (cfg.weekly.weeks > 0) segs.push({ id: "wk", name: "Semanal", phase: "continuo", cycles: cfg.weekly.weeks, len: 7, comps: [{ drug: cfg.drug, basis: cfg.weekly.basis, dose: cfg.weekly.dose, days: [1] }] });
  if (cfg.biweekly && cfg.biweekly.doses > 0) segs.push({ id: "bw", name: "Quincenal", phase: "continuo", cycles: cfg.biweekly.doses, len: 14, comps: [{ drug: cfg.drug, basis: cfg.biweekly.basis, dose: cfg.biweekly.dose, days: [1] }] });
  return { id: "bsab-" + cfg.drug, name: cfg.name || cfg.drug, line: "3", segs, maint: [] };
}

/* ---------- Utilidades de formato ---------- */
export const fmtEUR = (v, d = 2) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(v));
export const fmtNum = (v, d = 2) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v));
export const fmtPct = (v) => (v == null || isNaN(v) ? "—" : (v > 0 ? "+" : "") + new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v) + " %");

/* ---------- Utilidades adicionales ---------- */
export function doseCost(catalog, drug, doseMgValue, reuse = 0, priceFactor = 1, asOf) {
  return adminCost(doseMgValue, presentationsFor(catalog, drug, priceFactor, asOf), reuse);
}
export const HORIZONS = [
  { id: "cycle1", label: "Primer ciclo" }, { id: "3", label: "3 meses" }, { id: "6", label: "6 meses" },
  { id: "12", label: "12 meses" }, { id: "24", label: "24 meses" }, { id: "all", label: "Esquema completo" }, { id: "custom", label: "Otro (días)" },
];
export function horizonToDays(id, custom) {
  if (id === "all" || id === "cycle1") return id;
  if (id === "custom") return Math.max(1, Math.round(+custom || 1));
  return Math.round(+id * DAYS_PER_MONTH);
}
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function fmtDate(iso) { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
export function toCSV(rows) {
  return rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\n");
}
export function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false; const sep = text.indexOf(";") >= 0 && text.split("\n")[0].indexOf(";") >= 0 ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); if (row.some((x) => x !== "")) rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}
export function parseNumberEs(s) {
  if (typeof s === "number") return s;
  const t = String(s).trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(t); return t !== "" && isFinite(n) ? n : NaN;
}
