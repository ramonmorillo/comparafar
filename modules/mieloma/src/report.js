// Construcción pura de informes (texto, CSV y estructura) a partir del estado
import { computeScheme, compareSchemes, resolvePatient, horizonToDays, HORIZONS, fmtEUR, fmtNum, fmtDate, toCSV, ENGINE_VERSION, sensitivity } from "./engine.js";
import { DRUGS } from "./data.js";
import { ecoLines, ecoCSVRows } from "./exportsEco.js";

export const DATA_VERSION = "datos-excel-2026-11-17.1";
export const dn = (d) => DRUGS[d] || d;
export const horizonLabel = (c) => (HORIZONS.find((h) => h.id === c.horizon) || {}).label + (c.horizon === "custom" ? ` (${c.horizonCustom} d)` : "");

export function patientParams(p) { const r = resolvePatient(p); return { weight: p.weight, height: p.height, sc: r.sc, scSource: r.scSource, errors: r.errors }; }
export function calcOpts(c, extra = {}) {
  return { horizon: horizonToDays(c.horizon, c.horizonCustom), reuse: (c.reuse || 0) / 100, roundStep: c.roundStep || 0, applyCaps: !!c.applyCaps, maint: c.maint || "none", cyclesOverride: c.cycles || {}, ...extra };
}
export function lineLabel(l) {
  if (l.label) return l.label;
  const unit = l.basis === "mgkg" ? "mg/kg" : l.basis === "mgm2" ? "mg/m²" : "mg";
  return `${dn(l.drug)} ${fmtNum(l.dose, l.dose < 1 ? 2 : l.dose % 1 ? 1 : 0)} ${unit}`;
}

export function buildCalcReport(S, patient, calcSettings, scheme, extra = {}) {
  const pt = patientParams(patient);
  const opts = calcOpts(calcSettings);
  const res = computeScheme(scheme, S.catalog, patient, opts);
  const variant = scheme.maint && scheme.maint.find((v) => v.id === calcSettings.maint);
  const priced = S.catalog.filter((c) => !c.archived && c.mg > 0 && res.lines.some((l) => l.drug === c.drug));
  const sources = priced.map((c) => { const h = c.history[c.history.length - 1]; return h ? `${c.label}: ${fmtEUR(h.price)} (${h.type}${h.from ? ", vigente desde " + fmtDate(h.from) : ""}; fuente: ${h.source})` : `${c.label}: sin precio`; });
  const flags = (scheme.flags || []).map((f) => f.text);
  const warn = res.warnings.map((w) => w.text);
  const lines = res.lines.map((l) => ({ nombre: lineLabel(l), admin: l.admins, mg: l.totalMg, viales: l.vials, teor: l.theor, full: l.full, eff: l.eff, priced: l.priced }));
  return { kind: "calc", res, pt, scheme, variant, lines, sources, flags, warn, opts, horizon: horizonLabel(calcSettings), reuse: calcSettings.reuse, roundStep: calcSettings.roundStep, applyCaps: calcSettings.applyCaps, ...extra };
}

export function reportText(S, rep, cfg, meta) {
  const L = [];
  L.push(cfg.header, cfg.center, `Fecha: ${fmtDate(meta.date)} · Motor v${ENGINE_VERSION} · ${DATA_VERSION}`, "");
  if (rep.kind === "calc") {
    L.push(`PACIENTE (código pseudonimizado): ${meta.patientCode}`, `Peso ${fmtNum(rep.pt.weight, 1)} kg · Talla ${fmtNum(rep.pt.height, 2)} m · SC ${rep.pt.sc ? fmtNum(rep.pt.sc, 3) : "—"} m² (${rep.pt.scSource})`, "");
    L.push(`ESQUEMA: ${rep.scheme.name} (${rep.scheme.route || ""}) · Línea ${rep.scheme.line}${rep.variant ? " · Mantenimiento: " + rep.variant.label : ""}`);
    L.push(`Horizonte: ${rep.horizon} · Aprovechamiento de viales: ${rep.reuse || 0} % · Redondeo de dosis: ${rep.roundStep || "no"}`);
    const t = rep.res.totals;
    if (t) {
      L.push("", `Coste teórico (mg): ${fmtEUR(t.theor)}`, `Coste por envases completos: ${fmtEUR(t.full)}`, `Coste tras ajustes: ${fmtEUR(t.eff)}`, `Administraciones: ${t.admins}`, "");
      L.push("Desglose (fármaco; admin.; mg totales; envases; teórico; completos; tras ajustes)");
      rep.lines.forEach((l) => L.push(`- ${l.nombre}; ${l.admin}; ${fmtNum(l.mg, 1)}; ${l.viales}; ${l.priced ? fmtEUR(l.teor) : "sin precio"}; ${l.priced ? fmtEUR(l.full) : "sin precio"}; ${l.priced ? fmtEUR(l.eff) : "sin precio"}`));
    }
    rep.warn.forEach((w) => L.push("AVISO: " + w));
    rep.flags.forEach((w) => L.push("PENDIENTE DE VALIDAR: " + w));
    L.push("", "Precios y fuentes:", ...rep.sources.map((s) => "- " + s));
    L.push(...ecoLines(rep.eco));
  } else {
    L.push(`PACIENTE (código pseudonimizado): ${meta.patientCode}`, `Peso ${fmtNum(rep.pt.weight, 1)} kg · Talla ${fmtNum(rep.pt.height, 2)} m · SC ${rep.pt.sc ? fmtNum(rep.pt.sc, 3) : "—"} m² (${rep.pt.scSource})`, `Horizonte: ${rep.horizon} · Aprovechamiento: ${rep.reuse || 0} %`, "");
    L.push("COMPARACIÓN ECONÓMICA (coste tras ajustes; diferencia respecto al primer esquema)");
    rep.cols.forEach((c) => L.push(`- ${c.name}: ${fmtEUR(c.eff)} (teórico ${fmtEUR(c.theor)}; envases completos ${fmtEUR(c.full)})${c.diff != null ? `; dif. ${fmtEUR(c.diff)} (${fmtNum(c.pct, 1)} %)` : " [referencia]"}`));
    rep.warn.forEach((w) => L.push("AVISO: " + w));
    L.push(...ecoLines(rep.eco));
  }
  L.push("", cfg.footer, `Elaborado por: ${meta.author || "—"} · Revisado por: ${meta.reviewer || "—"}`);
  if (meta.notes) L.push("Observaciones: " + meta.notes);
  return L.join("\n");
}

// Resumen para historia clínica: SIN identificadores
export function clinicalSummary(rep) {
  if (rep.kind !== "calc") return "";
  const t = rep.res.totals; if (!t) return "";
  return `Cálculo farmacoeconómico (apoyo, no recomendación): ${rep.scheme.name}${rep.variant ? " + " + rep.variant.label : ""}, ${rep.horizon.toLowerCase()}. Peso ${fmtNum(rep.pt.weight, 1)} kg, SC ${fmtNum(rep.pt.sc, 2)} m² (${rep.pt.scSource}). Coste tras ajustes ${fmtEUR(t.eff)} (teórico ${fmtEUR(t.theor)}; envases completos ${fmtEUR(t.full)}); ${t.admins} administraciones. Precios y pautas importados del Excel, pendientes de validación. Motor v${ENGINE_VERSION}.`;
}

export function calcCSV(rep) {
  const rows = [["Fármaco/pauta", "Administraciones", "mg totales", "Envases", "Coste teórico", "Coste envases completos", "Coste tras ajustes", "Con precio"]];
  rep.lines.forEach((l) => rows.push([l.nombre, l.admin, fmtNum(l.mg, 2), l.viales, fmtNum(l.teor, 2), fmtNum(l.full, 2), fmtNum(l.eff, 2), l.priced ? "sí" : "no"]));
  const t = rep.res.totals; if (t) rows.push(["TOTAL", t.admins, "", t.vials, fmtNum(t.theor, 2), fmtNum(t.full, 2), fmtNum(t.eff, 2), ""]);
  rows.push([], ["Supuestos"], ["Esquema", rep.scheme.name], ["Peso (kg)", rep.pt.weight], ["Talla (m)", rep.pt.height], ["SC (m²)", rep.pt.sc ? fmtNum(rep.pt.sc, 3) : ""], ["Origen SC", rep.pt.scSource], ["Horizonte", rep.horizon], ["Aprovechamiento viales (%)", rep.reuse || 0], ["Versión motor", ENGINE_VERSION], ["Versión datos", DATA_VERSION]);
  rows.push(...ecoCSVRows(rep.eco));
  return toCSV(rows);
}

export function buildCompareReport(S, patient, cmp, schemes, extra = {}) {
  const items = cmp.items.map((it) => ({ scheme: schemes.find((s) => s.id === it.schemeId), maint: it.maint || "none" })).filter((i) => i.scheme);
  const opts = calcOpts({ ...cmp, maint: "none", cycles: {} });
  const out = compareSchemes(items, S.catalog, patient, opts);
  const pt = patientParams(patient);
  const base = out.results[0] && out.results[0].r.totals;
  const cols = out.results.map(({ it, r }, i) => {
    const t = r.totals || { theor: 0, full: 0, eff: 0, admins: 0, vials: 0 };
    const v = it.scheme.maint && it.scheme.maint.find((x) => x.id === it.maint);
    return { id: it.scheme.id, name: it.scheme.name + (it.scheme.route ? ` ${it.scheme.route === "IV" || it.scheme.route === "SC" ? "" : ""}` : "") + (v ? " + " + v.label.split(" (")[0] : ""), res: r, theor: t.theor, full: t.full, eff: t.eff, admins: t.admins, diff: i === 0 || !base ? null : t.eff - base.eff, pct: i === 0 || !base || !base.eff ? null : ((t.eff - base.eff) / base.eff) * 100, flags: it.scheme.flags || [], scheme: it.scheme };
  });
  const warn = [];
  out.results.forEach(({ it, r }) => r.warnings.filter((w) => w.level !== "info").forEach((w) => warn.push(`${it.scheme.name}: ${w.text}`)));
  return { kind: "cmp", out, cols, pt, warn, horizon: horizonLabel(cmp), reuse: cmp.reuse, opts, ...extra };
}

export function compareCSV(rep) {
  const rows = [["Esquema", "Coste teórico", "Coste envases completos", "Coste tras ajustes", "Dif. abs. vs referencia", "Dif. %", "Administraciones"]];
  rep.cols.forEach((c) => rows.push([c.name, fmtNum(c.theor, 2), fmtNum(c.full, 2), fmtNum(c.eff, 2), c.diff == null ? "referencia" : fmtNum(c.diff, 2), c.pct == null ? "" : fmtNum(c.pct, 1), c.admins]));
  rows.push([], ["Desglose por fármaco (coste tras ajustes)", ...rep.cols.map((c) => c.name)]);
  rep.out.byDrug.forEach((d) => rows.push([dn(d.drug), ...d.vals.map((v) => (v.priced ? fmtNum(v.eff, 2) : "sin precio"))]));
  rows.push([], ["Supuestos"], ["Peso (kg)", rep.pt.weight], ["Talla (m)", rep.pt.height], ["SC (m²)", rep.pt.sc ? fmtNum(rep.pt.sc, 3) : ""], ["Origen SC", rep.pt.scSource], ["Horizonte", rep.horizon], ["Aprovechamiento viales (%)", rep.reuse || 0], ["Versión motor", ENGINE_VERSION], ["Versión datos", DATA_VERSION], ["Nota", "Comparación económica; no implica superioridad terapéutica."]);
  rows.push(...ecoCSVRows(rep.eco));
  return toCSV(rows);
}
