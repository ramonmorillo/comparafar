import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCalcReport, buildCompareReport, calcCSV, compareCSV, reportText } from "../src/report.js";
import { ecoSection } from "../src/exportsEco.js";
import { saveAgreement } from "../src/agreements.js";
import { commercialAccess } from "../src/access.js";
import { CATALOG_INITIAL, SCHEMES_ALL, PATIENTS_DEMO, CONFIG_DEFAULT } from "../src/data.js";

// ESCENARIO 6 · Un registro anterior a la migración (sin ninguna clave nueva) se abre y se exporta igual que con la versión anterior.
// Los valores esperados («golden») se generaron con report.js del commit fb8382d, antes de estos cambios.
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/legacy-exports.json", import.meta.url), "utf8"));
const S = { catalog: JSON.parse(JSON.stringify(CATALOG_INITIAL)) }; // sin ref, priceVersions, agreements, estimates…
const pat = (p) => ({ weight: p.weight, height: p.height, scMethod: p.scMethod, scOverride: p.scOverride });
const calc = { schemeId: "1N-ISAVRD-IV", maint: "none", horizon: "12", horizonCustom: 365, reuse: 0, roundStep: 0, applyCaps: false, cycles: {} };
const cmp = { items: [{ schemeId: "1N-ISAVRD-IV", maint: "none" }, { schemeId: "1N-DVRD-IV", maint: "none" }], horizon: "12", horizonCustom: 365, reuse: 0, roundStep: 0, applyCaps: false };
const meta = { date: "2026-11-20", patientCode: "DEMO-001", author: "A", reviewer: "B", notes: "" };
const build = (eco) => ({ rep: buildCalcReport(S, pat(PATIENTS_DEMO[0]), calc, SCHEMES_ALL.find((s) => s.id === calc.schemeId), { eco }), rc: buildCompareReport(S, pat(PATIENTS_DEMO[0]), cmp, SCHEMES_ALL, { eco }) });

test("registro anterior: las exportaciones son idénticas byte a byte a las de la versión anterior", () => {
  const eco = ecoSection(S, SCHEMES_ALL, { access: commercialAccess({ status: "local" }) });
  assert.equal(eco, null, "sin acuerdos no hay sección económica");
  const { rep, rc } = build(eco);
  assert.equal(calcCSV(rep), golden.calcCSV);
  assert.equal(compareCSV(rc), golden.compareCSV);
  assert.equal(reportText(S, rep, CONFIG_DEFAULT, meta), golden.reportCalc);
  assert.equal(reportText(S, rc, CONFIG_DEFAULT, meta), golden.reportCmp);
});

test("con acuerdos, las exportaciones añaden la sección económica solo con permiso; sin permiso, nota sin condiciones", () => {
  const ags = saveAgreement([], { type: "techo", title: "Techo bortezomib", scope: { level: "principio_activo", targetId: "legacy:bort" }, period: { kind: "natural", year: 2026 }, effective: { from: "2026-01-01", to: null }, source: "Contrato", owner: "Jefa", threshold: { amountCents: 500000 } });
  const S2 = { ...S, agreements: ags };
  const withAccess = ecoSection(S2, SCHEMES_ALL, { access: commercialAccess({ status: "ready", role: "editor" }), asOf: "2026-11-20" });
  const csv = calcCSV(build(withAccess).rep);
  assert.ok(csv.startsWith(golden.calcCSV.split("\n")[0]));
  assert.match(csv, /Acuerdos y medidas de gasto vigentes/); assert.match(csv, /Techo bortezomib/); assert.match(csv, /pendiente/);
  const lector = ecoSection(S2, SCHEMES_ALL, { access: commercialAccess({ status: "ready", role: "lector" }), asOf: "2026-11-20" });
  const csvL = calcCSV(build(lector).rep);
  assert.doesNotMatch(csvL, /Techo bortezomib|Contrato/); assert.match(csvL, /no incluidas/);
  assert.doesNotMatch(reportText(S2, build(lector).rep, CONFIG_DEFAULT, meta), /Techo bortezomib/);
});
