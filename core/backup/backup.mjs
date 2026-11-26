// Copia de seguridad de la base compartida (Supabase) vía API REST, sin clave service_role ni conexión directa.
// Entra con una cuenta dedicada (rol revisor o admin) y vuelca cada tabla a JSON + un manifiesto con recuentos y hashes.
// Falla (código ≠ 0) ante cualquier duda: una copia vacía o parcial que parece buena es peor que ninguna.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Tablas de 001 y 003. `profiles` no se incluye: con rol revisor solo se ve la fila propia (ver BACKUP.md).
export const TABLES = ["catalog_items", "price_history", "schemes", "scheme_versions", "audit_log",
  "ref_ingredients", "ref_medicines", "ref_presentations", "ref_aliases", "price_versions", "agreements", "agreement_versions", "spend_entries"];
const OPTIONAL = new Set(["ref_ingredients", "ref_medicines", "ref_presentations", "ref_aliases", "price_versions", "agreements", "agreement_versions", "spend_entries"]); // dependen de 003
const PAGE = 1000;
const missing = (b) => b && (b.code === "42P01" || b.code === "PGRST205" || /could not find the table|does not exist/i.test(b.message || ""));

export async function runBackup({ url, key, email, password, outDir, fetchImpl = fetch, now = () => new Date() }) {
  if (!url || !key || !email || !password) throw new Error("Faltan credenciales de copia (url, key, email, password).");
  const j = async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch (e) { return { message: t.slice(0, 200) }; } };

  const lr = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const lb = await j(lr);
  if (!lr.ok || !lb || !lb.access_token) throw new Error("No se pudo iniciar sesión con la cuenta de copia (HTTP " + lr.status + ").");
  const H = { apikey: key, Authorization: "Bearer " + lb.access_token };

  // La cuenta debe estar activa y ser revisor/admin: con otro rol las tablas comerciales salen vacías SIN error.
  const pr = await fetchImpl(`${url}/rest/v1/profiles?select=role,active&id=eq.${lb.user.id}`, { headers: H });
  const prof = (await j(pr))?.[0];
  if (!pr.ok || !prof || !prof.active || !["revisor", "admin"].includes(prof.role)) throw new Error("La cuenta de copia debe estar activa y tener rol revisor o admin (rol actual: " + (prof ? prof.role + (prof.active ? "" : ", inactiva") : "desconocido") + ").");

  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { createdAt: now().toISOString(), role: prof.role, tables: {}, absent: [] };
  for (const t of TABLES) {
    const rows = []; let total = null;
    for (let o = 0; ; o += PAGE) {
      const r = await fetchImpl(`${url}/rest/v1/${t}?select=*&order=id`, { headers: { ...H, "Range-Unit": "items", Range: `${o}-${o + PAGE - 1}`, Prefer: "count=exact" } });
      const b = await j(r);
      if (!r.ok && missing(b) && OPTIONAL.has(t)) { manifest.absent.push(t); break; }
      if (!r.ok) throw new Error(`Error leyendo ${t}: HTTP ${r.status} ${(b && (b.message || b.code)) || ""}`);
      const cr = r.headers.get("content-range") || ""; const m = cr.match(/\/(\d+)$/); if (m) total = Number(m[1]);
      rows.push(...b);
      if (b.length < PAGE) break;
    }
    if (manifest.absent.includes(t)) continue;
    if (total != null && total !== rows.length) throw new Error(`Recuento incoherente en ${t}: la base indica ${total} filas y se leyeron ${rows.length}.`);
    const body = JSON.stringify(rows);
    fs.writeFileSync(path.join(outDir, t + ".json"), body);
    manifest.tables[t] = { rows: rows.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
  }
  if (!manifest.tables.catalog_items || manifest.tables.catalog_items.rows === 0) throw new Error("catalog_items está vacío: copia descartada (¿cuenta sin permisos o base vacía?).");
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

// Ejecución directa (GitHub Actions): variables de entorno; solo se escriben recuentos, nunca datos.
if (import.meta.url === `file://${process.argv[1]}`) {
  const e = process.env;
  runBackup({ url: e.SUPABASE_URL, key: e.SUPABASE_KEY, email: e.BACKUP_EMAIL, password: e.BACKUP_PASSWORD, outDir: process.argv[2] || "backup" })
    .then((m) => { console.log("Copia correcta · " + m.createdAt); for (const [t, v] of Object.entries(m.tables)) console.log(`${t}: ${v.rows} filas`); if (m.absent.length) console.log("Tablas ausentes (migración 003 sin aplicar): " + m.absent.join(", ")); })
    .catch((err) => { console.error("COPIA FALLIDA: " + err.message); process.exit(1); });
}
