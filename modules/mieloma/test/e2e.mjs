// Recorrido de extremo a extremo en Chromium con la app compilada (build/index.html) y documentos SINTÉTICOS.
// Requiere Playwright instalado (no es dependencia del proyecto):  node build/build.mjs && node test/e2e.mjs
// CIMA se simula con respuestas reales guardadas (test/fixtures); E2E_REAL_CIMA=1 usa el servicio real.
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { makePdf } from "./helpers/makepdf.mjs"; import { oncofarPages, SAMPLE_SINGLE, twoPhaseDoc } from "./helpers/oncofarDoc.mjs";
const require = createRequire(process.env.PW_PATH || "/opt/node-tools/x.js"); const { chromium } = require("playwright");
const root = path.resolve(import.meta.dirname, ".."); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "comparafar-e2e-"));
const shots = process.env.E2E_SHOTS || tmp;
const pdf = (name, pages) => { const f = path.join(tmp, name); fs.writeFileSync(f, makePdf(pages)); return f; };
const files = { scanned: pdf("escaneado.pdf", [{ image: true }]), two: pdf("dos-fases.pdf", oncofarPages(twoPhaseDoc(34))), sample: pdf("hoja-ejemplo.pdf", oncofarPages(SAMPLE_SINGLE)) };
const fx = (n) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", n), "utf8");
process.on("unhandledRejection", (e) => { console.log("  ✘ EXCEPCIÓN: " + String(e.message).split("\n")[0]); process.exitCode = 1; });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true }); });
const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/supabase|Failed to load resource|net::/i.test(m.text()) && errors.push(m.text()));
const sent = []; // todo lo que sale a la red hacia hosts que no son el propio fichero
page.on("request", (r) => { const u = r.url(); if (!u.startsWith("file:") && !u.startsWith("blob:") && !u.startsWith("data:")) sent.push({ url: u, body: r.postData() }); });
// React viene de cdnjs en el HTML compilado; sin red se sirve desde node_modules (mismas versiones 18.3.1).
await page.route("**/cdnjs.cloudflare.com/ajax/libs/react/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, "node_modules/react/umd/react.production.min.js"), "utf8") }));
await page.route("**/cdnjs.cloudflare.com/ajax/libs/react-dom/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, "node_modules/react-dom/umd/react-dom.production.min.js"), "utf8") }));
let cimaMode = "multi";
if (!process.env.E2E_REAL_CIMA) await page.route("**/cima.aemps.es/**", async (route) => {
  const u = new URL(route.request().url()); const h = { "access-control-allow-origin": "*", "content-type": "application/json" };
  if (cimaMode === "down") return route.abort("connectionrefused");
  if (cimaMode === "none") return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ totalFilas: 0, pagina: 1, tamanioPagina: 200, resultados: [] }) });
  if (u.pathname.endsWith("/medicamento")) return route.fulfill({ status: 200, headers: h, body: fx("cima-med-1231742002.json") });
  return route.fulfill({ status: 200, headers: h, body: fx("cima-search-bortezomib.json").replace('"totalFilas":38', '"totalFilas":38') });
});
const go = async (h) => { await page.evaluate((x) => (location.hash = x), h); await page.waitForTimeout(150); };
const shot = (n) => page.screenshot({ path: path.join(shots, n + ".png") });

await page.goto("file://" + root + "/build/index.html");
await page.getByRole("button", { name: /Usar sin conexión/ }).click();
console.log("1) Catálogo: alta manual y CIMA");
await go("catalogo");
async function newDrug(name, mg, price) {
  await go("catalogo");
  await page.getByRole("tab", { name: /Principios activos/ }).click();
  await page.getByLabel("Nuevo principio activo").fill(name); await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("tab", { name: /Medicamentos/ }).click(); await page.getByRole("button", { name: "+ Alta manual" }).click();
  await page.getByLabel("Nombre del medicamento").fill(name + " (medicamento)"); await page.getByLabel("Principio activo 1").selectOption({ label: name }); await page.getByRole("button", { name: "Crear" }).click();
  await page.getByRole("tab", { name: /Presentaciones/ }).click(); await page.getByRole("button", { name: "+ Alta manual" }).click();
  await page.locator(".modal").getByLabel("Medicamento", { exact: true }).selectOption({ label: name + " (medicamento)" });
  await page.getByLabel("Descripción de la presentación").fill(`${name} ${mg} mg vial`);
  await page.locator(".modal").getByLabel("mg de principio activo por unidad (vial/comprimido)").fill(String(mg)); await page.getByLabel(/He comprobado esta equivalencia/).check(); await page.getByRole("button", { name: "Crear" }).click();
  await go("costes");
  const row = page.locator("tr", { hasText: `${name} ${mg} mg vial` }).first(); await row.getByRole("button", { name: "Nueva versión" }).click();
  await page.getByLabel("Precio", { exact: true }).fill(String(price)); await page.getByLabel("Fuente del precio").fill("Contrato sintético E2E"); await page.getByLabel("Entrada en vigor").fill("2026-01-01");
  await page.getByRole("button", { name: "Guardar versión" }).click();
}
await newDrug("Farmaco Alfa", 2, "100,00"); await newDrug("Farmaco Beta", 100, "50,00");
await go("catalogo"); await page.getByRole("tab", { name: /Principios activos/ }).click();
ok(await page.getByText("Farmaco Alfa").first().isVisible(), "principio activo dado de alta con origen visible (Manual)");
// duplicado
await page.getByLabel("Nuevo principio activo").fill(" farmaco alfa "); await page.getByRole("button", { name: "Añadir" }).click();
ok(await page.getByText(/Ya existe/).first().isVisible(), "deduplicación de principio activo");
// CIMA: varias coincidencias
await page.getByRole("tab", { name: /Buscar en CIMA/ }).click(); cimaMode = "multi";
await page.getByLabel("Término de búsqueda en CIMA").fill("bortezomib"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
await page.getByText(/ficha\(s\) encontradas/).waitFor(); ok(true, "CIMA con varias coincidencias: lista para elegir");
// CIMA: sin resultados
cimaMode = "none"; await page.getByLabel("Término de búsqueda en CIMA").fill("zzzz"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
await page.getByText("Sin resultados en CIMA.").waitFor(); ok(true, "CIMA sin resultados: mensaje y alta manual indicada");
// CIMA: caída
cimaMode = "down"; await page.getByRole("button", { name: "Buscar", exact: true }).click();
await page.getByText(/CIMA no está disponible/).waitFor(); ok(true, "CIMA caída: aviso, el catálogo local sigue disponible");
await page.getByRole("tab", { name: /Principios activos/ }).click(); ok(await page.getByLabel("Nuevo principio activo").isEnabled(), "alta manual sigue disponible con CIMA caída");
// CIMA: incorporar ficha (glofitamab)
cimaMode = "multi"; await page.getByRole("tab", { name: /Buscar en CIMA/ }).click(); await page.getByLabel("Término de búsqueda en CIMA").fill("columvi"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
await page.getByRole("button", { name: "Ver ficha" }).first().click(); await page.getByText(/Confirmar ficha/).waitFor();
ok(await page.getByText("762973").first().isVisible(), "ficha CIMA: CN como texto y presentaciones elegibles"); await shot("01-cima-ficha");
await page.getByRole("button", { name: "Incorporar al catálogo" }).click();
await page.getByRole("tab", { name: /Presentaciones/ }).click(); ok(await page.getByText("762973").first().isVisible(), "presentación incorporada con CN"); ok(await page.getByText("Sin comprobar").first().isVisible(), "equivalencia propuesta queda «sin comprobar»");

console.log("2) Importación: PDF escaneado");
await go("importar");
await page.locator('input[type=file]').setInputFiles(files.scanned);
await page.getByText(/No se ha podido reconstruir/).waitFor(); ok(await page.getByText(/escaneado/).first().isVisible(), "PDF escaneado: motivo visible");
ok(await page.getByRole("button", { name: "Completar manualmente" }).isVisible(), "se ofrece completar manualmente"); await page.getByRole("button", { name: "Cerrar" }).click();

console.log("3) Importación: dos fases y varias páginas");
await page.locator('input[type=file]').setInputFiles(files.two);
await page.getByRole("heading", { name: "Revisar planificación" }).waitFor();
ok(await page.getByText(/Fase: Fase de inducción/).isVisible() && await page.getByText(/Fase: Fase de mantenimiento/).isVisible(), "dos fases conservadas");
ok(await page.getByText(/p\. 2/).first().isVisible(), "se conserva la página de origen (p. 2)");
ok(await page.getByRole("button", { name: "Confirmar y guardar plan" }).isDisabled(), "no se puede confirmar con datos sin confirmar");
await page.getByLabel("Fecha inicial").fill("2026-12-01");
// excluir filas de soporte (hidratación) para centrar el coste en los antineoplásicos
for (const c of await page.getByLabel("Confirmo ciclos e intervalo de esta fase").all()) await c.check();
// cada fila incluida: confirmar (las de soporte no incluidas no lo necesitan)
for (const c of await page.getByLabel("Confirmo días, dosis y catálogo").all()) await c.check();
await shot("02-revision");
ok(await page.getByRole("button", { name: "Confirmar y guardar plan" }).isEnabled(), "con todo confirmado se puede guardar");
await page.getByRole("button", { name: "Confirmar y guardar plan" }).dblclick(); // doble clic: no debe duplicar
await page.getByText("Plan confirmado.").waitFor(); ok(true, "plan confirmado");
await page.waitForTimeout(600); // el guardado local tiene un debounce de 300 ms
const plansAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("mielofarma:v1")).importedPlans.length);
ok(plansAfter === 1, "un solo plan guardado tras doble clic (" + plansAfter + ")");
const stored = await page.evaluate(() => localStorage.getItem("mielofarma:v1"));
{ const m = stored.match(/dos-fases|hoja-ejemplo|escaneado\.pdf|Hospital Universitario|%PDF/i); ok(!m, "no se persiste ni el PDF, ni su nombre, ni cabeceras del documento" + (m ? " — coincide: " + stored.slice(Math.max(0, m.index - 60), m.index + 60) : "")); }

console.log("4) Reimportación del mismo fichero");
await page.locator('input[type=file]').setInputFiles(files.two);
await page.getByText("Este fichero ya se importó en este contexto").waitFor(); ok(true, "se avisa de la reimportación");
ok(await page.getByRole("button", { name: /Crear revisión explícita/ }).isVisible(), "se ofrece revisión explícita");
await page.getByRole("button", { name: "Cancelar" }).click();
ok((await page.evaluate(() => JSON.parse(localStorage.getItem("mielofarma:v1")).importedPlans.length)) === 1, "cancelar no duplica ni modifica");

console.log("5) Costes: estimación guardada");
await go("costes"); await page.getByRole("tab", { name: /Estimaciones/ }).click();
await page.getByText(/Estimación completa|Total parcial/).first().waitFor();
const body1 = await page.locator("body").innerText(); ok(/Estimación completa/.test(body1), "estimación completa (todas las líneas valoradas)" + (/Estimación completa/.test(body1) ? "" : "\n" + body1.slice(body1.indexOf("Estimación"), body1.indexOf("Estimación") + 900)));
// ALFA 2×2 mg a 100 € (4 ciclos × 2 días) + BETA 8×100 mg a 50 € (4+6 ciclos) = 8×200 + 10×400
ok(/5\.?600,00\s*€/.test(body1), "total 5.600,00 € (8×200 + 10×400)" + (/5\.?600,00\s*€/.test(body1) ? "" : " — real: " + (body1.match(/(TOTAL|Total)[\s\S]{0,40}/) || [""])[0].replace(/\n/g, " ")));
await shot("03-estimacion");
await page.getByRole("button", { name: /Ver cómo se ha obtenido/ }).click(); ok(await page.getByText(/Contrato sintético E2E/).first().isVisible(), "se muestra el precio aplicado y su fuente");
// subida de precio entre ciclos: nueva versión desde 2026-12-15 (BETA 60 €) → cambia ciclos posteriores, se conserva la estimación anterior
await go("costes"); await page.getByRole("tab", { name: /Precios por presentación/ }).click();
await page.locator("tr", { hasText: "Farmaco Beta 100 mg vial" }).first().getByRole("button", { name: "Nueva versión" }).click();
await page.getByLabel("Precio", { exact: true }).fill("60"); await page.getByLabel("Fuente del precio").fill("Resolución nueva"); await page.getByLabel("Entrada en vigor").fill("2026-12-15");
await page.getByRole("button", { name: "Guardar versión" }).click();
await page.getByText(/se solapa con la versión vigente/).waitFor(); ok(true, "vigencia solapada rechazada");
await page.getByLabel("Cerrar la vigencia anterior").check(); await page.getByRole("button", { name: "Guardar versión" }).click();
await page.locator(".modal").waitFor({ state: "detached" }); ok(true, "con cierre explícito de la vigencia anterior se guarda");
await go("costes"); await page.getByRole("tab", { name: /Estimaciones/ }).click();
await page.getByRole("button", { name: /Recalcular/ }).click(); await page.getByLabel("Paciente").selectOption("DEMO-001"); await page.getByRole("button", { name: "Calcular y guardar" }).click();
await page.waitForTimeout(300);
const body2 = await page.locator("body").innerText();
// BETA: cada administración desde el 15/12/2026 a 60 € → 8 viales = 480 €. Fechas: 1/12, 22/12 (ciclo 2 ya con 60 €)…
ok(!/5\.?600,00\s*€/.test(body2.split("Historial de estimaciones")[0]), "la nueva estimación usa el precio nuevo");
ok((await page.locator(".plist li").count()) === 2, "se conservan las dos estimaciones");
await page.locator(".plist li").nth(1).click(); ok(/5\.?600,00\s*€/.test(await page.locator("body").innerText()), "la estimación anterior conserva su total y precio");
await page.getByRole("button", { name: "Copiar CSV" }).click();
const csv = await page.evaluate(() => window.__copied.at(-1)); ok(/Regla de cálculo/.test(csv) && /Total \(€\)/.test(csv) && /Contrato sintético E2E/.test(csv), "CSV de estimación con regla, total y fuente de precio");

console.log("6) Acuerdos de gasto");
await go("acuerdos"); await page.getByRole("button", { name: "+ Nuevo acuerdo" }).click();
await page.getByLabel("Título").fill("Techo Farmaco Beta 2026"); await page.getByLabel("Elemento", { exact: true }).selectOption({ label: "Farmaco Beta" });
await page.getByLabel("Fuente", { exact: true }).fill("Contrato 14/2026"); await page.getByLabel("Responsable").fill("Jefa de Servicio"); await page.getByLabel("Techo de gasto").fill("1000");
await page.getByRole("button", { name: "Guardar" }).click();
await page.getByText("Techo Farmaco Beta 2026").first().waitFor(); ok(await page.getByText(/Gasto realizado pendiente/).isVisible(), "sin fuente de gasto realizado: pendiente, no 0 €");
await page.getByRole("button", { name: "Registrar acumulado fechado" }).click();
await page.getByLabel("Importe", { exact: true }).fill("1200"); await page.getByLabel("Procedencia").fill("Informe contable 20/11"); await page.getByRole("button", { name: "Guardar" }).click();
await page.getByText(/Techo superado en/).first().waitFor(); ok(true, "techo superado: señal visible"); ok(await page.getByText(/excedido en/).first().isVisible(), "importe excedido visible");
await shot("04-acuerdos");
// dos acuerdos coincidentes sin orden
for (const [t, kind] of [["Descuento 10 % Beta", "pct"], ["Volumen Beta", "pct"]]) {
  await page.getByRole("button", { name: "+ Nuevo acuerdo" }).click(); await page.getByLabel("Tipo de medida").selectOption("descuento"); await page.getByLabel("Título").fill(t);
  await page.getByLabel("Elemento", { exact: true }).selectOption({ label: "Farmaco Beta" }); await page.getByLabel("Fuente", { exact: true }).fill("Contrato B"); await page.getByLabel("Responsable").fill("Jefa");
  await page.getByLabel("Fórmula").selectOption("pct"); await page.getByLabel("Porcentaje").fill("10"); await page.getByLabel("Mecanismo de liquidación").fill("Abono"); await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText(t).first().waitFor();
}
ok(await page.getByText("Acuerdos coincidentes.").first().isVisible(), "acuerdos coincidentes: incidencia visible");
ok((await page.getByText("Ajuste pendiente").count()) >= 2, "ajustes sin regla de interacción: pendientes");
const ecoCsvBtn = page.getByRole("button", { name: "Copiar CSV económico" }); await ecoCsvBtn.click();
const ecoCsv = await page.evaluate(() => window.__copied.at(-1)); ok(/Gasto realizado/.test(ecoCsv) && /Gasto proyectado/.test(ecoCsv) && /Importe computable/.test(ecoCsv) && /Ajustes registrados/.test(ecoCsv), "exportación económica distingue realizado, proyectado, computable y ajustes registrados");
ok(/Techo Farmaco Beta 2026/.test(ecoCsv) && /excedido en/.test(ecoCsv), "la exportación recoge el techo excedido");

console.log("7) Exportaciones existentes con los nuevos campos");
await go("calculadora"); await page.getByRole("button", { name: "Copiar tabla CSV" }).first().click();
const calcCsv = await page.evaluate(() => window.__copied.at(-1)); ok(/Acuerdos y medidas de gasto vigentes/.test(calcCsv), "el CSV de la calculadora incorpora los acuerdos vigentes");

console.log("8) Registro anterior a la migración");
const legacy = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("mielofarma:v1")); for (const k of ["ref", "priceVersions", "agreements", "spendEntries", "importDrafts", "importedPlans", "estimates"]) delete s[k]; return JSON.stringify(s); });
await page.evaluate((j) => localStorage.setItem("mielofarma:v1", j), legacy); await page.reload(); await page.getByRole("button", { name: /Usar sin conexión/ }).click();
for (const r of ["inicio", "precios", "calculadora", "comparador", "informes", "importar", "catalogo", "costes", "acuerdos"]) { await go(r); await page.waitForTimeout(120); }
await go("calculadora"); await page.getByRole("button", { name: "Copiar tabla CSV" }).first().click();
const calcCsv2 = await page.evaluate(() => window.__copied.at(-1)); ok(/TOTAL/.test(calcCsv2) && !/Acuerdos y medidas/.test(calcCsv2), "exportación de un registro anterior: igual que antes, sin sección económica");
await go("precios"); ok(await page.getByText("Catálogo de costes").isVisible(), "el catálogo heredado sigue accesible");
await go("agenda"); ok(await page.getByText("Agenda de tratamiento").isVisible(), "la agenda heredada sigue accesible");

console.log("9) Red");
const external = sent.filter((r) => !/cdnjs|fonts\.(googleapis|gstatic)|supabase\.co|cima\.aemps\.es/.test(r.url));
ok(external.length === 0, "ninguna petición a servicios no previstos: " + external.map((r) => r.url).join(", "));
const cimaReq = sent.filter((r) => /cima\.aemps/.test(r.url));
ok(cimaReq.every((r) => /nombre=|practiv1=|nregistro=|cn=/.test(r.url) && !/paciente|DEMO|dos-fases|Farmaco/i.test(r.url + (r.body || ""))), "a CIMA solo se envían términos de catálogo (" + cimaReq.length + " peticiones)");
ok(!sent.some((r) => /%PDF|dos-fases|hoja-ejemplo/.test((r.body || "") + r.url)), "el PDF y su nombre no salen del navegador");
ok(errors.length === 0, "sin errores de consola/JS" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); console.log(fails ? `\n${fails} comprobación(es) fallida(s)` : "\nE2E correcto"); process.exit(fails ? 1 : 0);
