// Recorrido en Chromium de anular (precios, gasto, acuerdos) y editar/archivar (catálogo), con la app compilada y datos sintéticos.
// Sin conexión (modo local): no toca Supabase. Requiere Playwright (no es dependencia del proyecto):  node build/build.mjs && node test/e2e-anular.mjs
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path";
import { CATALOG_INITIAL } from "../src/data.js";
const require = createRequire(process.env.PW_PATH || "/opt/node-tools/x.js"); const { chromium } = require("playwright");
const root = path.resolve(import.meta.dirname, "..");
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };
const label = CATALOG_INITIAL.find((c) => c.id === "C03").label;
const seed = {
  v: 1,
  ref: { ingredients: [{ id: "PA-1", name: "Principio E2E", nameNorm: "principio e2e", source: { kind: "manual" } }],
    medicines: [{ id: "MED-1", name: "MedicamentoE2E", nregistro: null, labtitular: "", forma: "", atc: null, ingredients: [{ ingredientId: "PA-1", amount: "", unit: "" }], source: { kind: "manual" }, archived: false }],
    presentations: [{ id: "PR-1", medicineId: "MED-1", cn: "700001", label: "Caja E2E", content: null, conversion: null, oral: false, source: { kind: "manual" }, archived: false }], aliases: [] },
  priceVersions: [{ id: "V-E2E", presId: "C03", center: "", condition: "general", price: 10, priceUnits: 100000, currency: "EUR", purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "sin_iva", rate: null }, source: "Contrato E2E", from: "2026-01-01", to: null, note: "", priceType: "contrato", origin: "manual", by: "u@x", at: "2026-01-02T00:00:00Z" }],
  agreements: [
    { id: "A-1", version: 1, type: "techo", title: "Techo E2E uno", scope: { level: "principio_activo", targetId: "legacy:bort" }, period: { kind: "natural", year: 2026 }, effective: { from: "2026-01-01" }, threshold: { amountCents: 100000 }, source: "Acta", owner: "Jefe", createdAt: "2026-01-01T00:00:00Z", history: [] },
    { id: "A-2", version: 1, type: "techo", title: "Techo E2E dos", scope: { level: "presentacion", targetId: "PR-1" }, period: { kind: "natural", year: 2026 }, effective: { from: "2026-01-01" }, threshold: { amountCents: 50000 }, source: "Acta", owner: "Jefe", createdAt: "2026-01-01T00:00:00Z", history: [] }],
  spendEntries: [{ id: "SE-E2E", kind: "realizado", scope: { level: "principio_activo", targetId: "legacy:bort" }, from: "2026-01-01", to: "2026-06-30", asOf: "2026-06-30", amountCents: 123400, source: "Contabilidad E2E", by: "u@x", at: "2026-07-01T00:00:00Z" }],
};
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/cdnjs.cloudflare.com/ajax/libs/react/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, "node_modules/react/umd/react.production.min.js"), "utf8") }));
await page.route("**/cdnjs.cloudflare.com/ajax/libs/react-dom/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, "node_modules/react-dom/umd/react-dom.production.min.js"), "utf8") }));
await page.route("**/*supabase.co/**", (r) => r.abort("connectionrefused"));
await page.addInitScript((j) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("mielofarma:v1", j); sessionStorage.setItem("seeded", "1"); } }, JSON.stringify(seed));
await page.goto("file://" + root + "/build/index.html");
await page.getByRole("button", { name: /Usar sin conexión/ }).click();
const modal = () => page.getByRole("dialog");
const anular = async (reason) => { const m = modal(); const btn = m.getByRole("button", { name: "Anular", exact: true }); ok(await btn.isDisabled(), "  sin motivo el botón Anular está desactivado"); await m.getByLabel("Motivo de la anulación").fill(reason); await btn.click(); await modal().waitFor({ state: "detached" }); };

console.log("Precios (Costes)");
await page.goto("file://" + root + "/build/index.html#costes"); await page.reload(); await page.getByRole("button", { name: /Usar sin conexión/ }).click().catch(() => {});
await page.getByLabel("Buscar presentación").fill(label);
await page.getByRole("button", { name: /^Historial/ }).first().click();
ok(await page.getByText("Contrato E2E").first().isVisible(), "el historial muestra la versión de precio");
await page.getByRole("button", { name: "Anular", exact: true }).first().click();
await anular("Precio mal transcrito");
ok((await page.getByText("Contrato E2E").count()) === 0, "la versión anulada desaparece del historial");
await page.getByLabel(/Mostrar versiones anuladas/).check();
ok(await page.getByText(/Precio mal transcrito/).first().isVisible() && await page.getByText("Anulada", { exact: true }).first().isVisible(), "con «mostrar anuladas» se ve con su motivo y la marca de anulada");

console.log("Acuerdos y gasto");
await page.goto("file://" + root + "/build/index.html#acuerdos");
await page.getByRole("button", { name: "Anular", exact: true }).first().waitFor();
const nAnular = await page.getByRole("button", { name: "Anular", exact: true }).count();
ok(nAnular === 3, "hay un botón Anular por acuerdo (2) y por registro de gasto (1)  [" + nAnular + "]");
await page.getByText("Contabilidad E2E").waitFor();
await page.locator("tr", { hasText: "Contabilidad E2E" }).getByRole("button", { name: "Anular" }).click();
await anular("Importe de otro periodo");
ok((await page.locator("tr", { hasText: "Contabilidad E2E" }).count()) === 0, "el gasto anulado desaparece de la tabla");
await page.getByLabel(/Mostrar registros anulados/).check();
ok(await page.locator("tr", { hasText: "Contabilidad E2E" }).getByText(/Importe de otro periodo/).isVisible(), "se ve anulado con su motivo");
await page.getByRole("heading", { name: "Techo E2E uno" }).locator("xpath=ancestor::*[contains(@class,'card')][1]").getByRole("button", { name: "Anular" }).click();
await anular("Contrato resuelto");
ok((await page.getByRole("heading", { name: "Techo E2E uno" }).count()) === 0, "el acuerdo anulado deja de aparecer entre los vigentes");
await page.getByLabel(/Mostrar acuerdos anulados/).check();
ok(await page.getByText(/Contrato resuelto/).first().isVisible(), "con «mostrar anulados» se ve su motivo");

console.log("Catálogo: editar y archivar");
await page.goto("file://" + root + "/build/index.html#catalogo");
await page.getByRole("tab", { name: /Medicamentos/ }).click().catch(async () => { await page.getByText(/^Medicamentos/).first().click(); });
await page.locator("tr", { hasText: "MedicamentoE2E" }).getByRole("button", { name: "Editar" }).click();
await modal().getByLabel("Laboratorio titular").fill("Lab E2E");
await modal().getByRole("button", { name: "Guardar" }).click(); await modal().waitFor({ state: "detached" });
ok(await page.locator("tr", { hasText: "MedicamentoE2E" }).getByText(/Lab E2E/).isVisible(), "la edición del medicamento se refleja");
await page.locator("tr", { hasText: "MedicamentoE2E" }).getByRole("button", { name: "Archivar" }).click();
ok(await modal().getByText(/acuerdo\(s\) que apuntan/).isVisible(), "archivar avisa del acuerdo que apunta a su presentación");
await modal().getByRole("button", { name: "Archivar", exact: true }).click(); await modal().waitFor({ state: "detached" });
ok((await page.locator("tr", { hasText: "MedicamentoE2E" }).count()) === 0, "el medicamento archivado se oculta");
await page.getByLabel(/Mostrar medicamentos archivados/).check();
await page.locator("tr", { hasText: "MedicamentoE2E" }).getByRole("button", { name: "Restaurar" }).click();
await modal().getByRole("button", { name: "Restaurar", exact: true }).click(); await modal().waitFor({ state: "detached" });
ok((await page.locator("tr", { hasText: "MedicamentoE2E" }).getByText("Archivado").count()) === 0, "restaurado");
await page.getByRole("tab", { name: /Presentaciones/ }).click().catch(async () => { await page.getByText(/^Presentaciones/).first().click(); });
await page.locator("tr", { hasText: "Caja E2E" }).getByRole("button", { name: "Editar" }).click();
await modal().getByLabel("Código nacional").fill("12");
await modal().getByRole("button", { name: "Guardar" }).click();
ok(await page.getByText(/código nacional son 6 o 7 dígitos/i).first().isVisible() && await modal().isVisible(), "CN inválido rechazado con mensaje, sin cerrar la ventana ni romper la página");
await modal().getByRole("button", { name: "Cancelar" }).click();

ok(errors.length === 0, "sin errores de JavaScript en la página" + (errors.length ? ": " + errors[0] : ""));
await browser.close(); console.log(fails ? `\n${fails} fallo(s)` : "\nE2E anular/archivar correcto"); process.exit(fails ? 1 : 0);
