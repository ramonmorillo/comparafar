import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBackup, TABLES } from "../../../core/backup/backup.mjs";

// Servidor simulado de Supabase: tablas en memoria, paginación por Range, rol configurable.
function mock({ role = "revisor", active = true, data = {}, absent = [], loginOk = true, lie = false } = {}) {
  return async (url, opts = {}) => {
    const u = new URL(url); const res = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });
    if (u.pathname === "/auth/v1/token") return loginOk ? res(200, { access_token: "tok", user: { id: "u1" } }) : res(400, { message: "Invalid login" });
    if (u.pathname === "/rest/v1/profiles") return res(200, [{ role, active }]);
    const t = u.pathname.split("/").pop();
    if (absent.includes(t)) return res(404, { code: "PGRST205", message: "Could not find the table" });
    const all = data[t] || []; const [a, b] = opts.headers.Range.split("-").map(Number);
    const page = all.slice(a, b + 1);
    return res(page.length && a + page.length < all.length ? 206 : 200, page, { "content-range": `${a}-${a + page.length - 1}/${lie ? all.length + 1 : all.length}` });
  };
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: "r" + String(i).padStart(5, "0") }));
const run = (f, extra = {}) => runBackup({ url: "https://x.supabase.co", key: "k", email: "b@x", password: "p", outDir: fs.mkdtempSync(path.join(os.tmpdir(), "bk-")), fetchImpl: f, ...extra });

test("copia completa: pagina más de 1000 filas y el manifiesto cuadra con los ficheros", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  const m = await run(mock({ data: { catalog_items: rows(2350), schemes: rows(3) } }), { outDir: dir });
  assert.equal(m.tables.catalog_items.rows, 2350);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "catalog_items.json"))).length, 2350);
  assert.ok(fs.existsSync(path.join(dir, "manifest.json")));
});
test("las tablas de 003 ausentes se anotan; las de 001 ausentes son un error", async () => {
  const m = await run(mock({ data: { catalog_items: rows(1) }, absent: ["price_versions", "agreements"] }));
  assert.deepEqual(m.absent.sort(), ["agreements", "price_versions"]);
  await assert.rejects(run(mock({ data: { catalog_items: rows(1) }, absent: ["schemes"] })), /schemes/);
});
test("rechaza cuenta con rol lector/editor o inactiva (daría tablas vacías sin error)", async () => {
  await assert.rejects(run(mock({ role: "editor", data: { catalog_items: rows(1) } })), /revisor o admin/);
  await assert.rejects(run(mock({ active: false, data: { catalog_items: rows(1) } })), /inactiva/);
});
test("falla si el login falla, si catalog_items está vacío o si el recuento no cuadra", async () => {
  await assert.rejects(run(mock({ loginOk: false })), /iniciar sesión/);
  await assert.rejects(run(mock({ data: {} })), /catalog_items está vacío/);
  await assert.rejects(run(mock({ data: { catalog_items: rows(5) }, lie: true })), /Recuento incoherente/);
});
test("la lista de tablas cubre 001 y 003", () => { for (const t of ["catalog_items", "price_history", "schemes", "audit_log", "agreements", "spend_entries"]) assert.ok(TABLES.includes(t)); });
