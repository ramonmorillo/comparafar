import { createClient } from "@supabase/supabase-js";
import { CLOUD } from "./cloudConfig.js";
import { rowsToCatalog, itemToRow, priceToRow, schemeToRow, rowToScheme, isConflict } from "./cloudMap.js";
import { ecoFromRows } from "./cloudEco.js";

let sb = null;
export const client = () => sb || (sb = createClient(CLOUD.url, CLOUD.key, { auth: { persistSession: true, autoRefreshToken: true } }));
const must = (r) => { if (r.error) throw r.error; return r.data; };

export const getSession = async () => must(await client().auth.getSession()).session;
export const signIn = async (email, password) => must(await client().auth.signInWithPassword({ email, password })).session;
export const signOut = async () => { await client().auth.signOut(); };
export const getProfile = async (uid) => must(await client().from("profiles").select("email,full_name,role,active").eq("id", uid).maybeSingle());

export async function pullAll() {
  const c = client();
  const [items, prices, schemes] = await Promise.all([
    c.from("catalog_items").select("*").then(must),
    c.from("price_history").select("*").order("id").then(must),
    c.from("schemes").select("*").then(must),
  ]);
  return { catalog: rowsToCatalog(items, prices), schemes: schemes.map(rowToScheme) };
}
export async function pushCatalog({ upserts, prices }) {
  const c = client();
  if (upserts.length) must(await c.from("catalog_items").upsert(upserts));
  if (prices.length) must(await c.from("price_history").insert(prices));
}
export async function pushSchemes({ inserts, updates }) {
  const c = client();
  for (const s of inserts) must(await c.from("schemes").insert(schemeToRow({ ...s, version: 1 })));
  for (const u of updates) {
    const row = schemeToRow({ ...u.scheme, version: u.expected + 1 });
    const { id, ...rest } = row;
    const r = must(await c.from("schemes").update(rest).eq("id", id).eq("version", u.expected).select("id"));
    if (!r.length) { const e = new Error("Conflicto de versión: el esquema " + id + " ha cambiado en la nube."); e.code = "40001"; throw e; }
  }
}
/* ---------- Módulos económicos (migración 003) ---------- */
// Un lector no recibe condiciones comerciales (la RLS tampoco se las daría): no se piden.
export async function pullEco({ canSeeCommercial }) {
  const c = client();
  const q = (t, order = "id") => c.from(t).select("*").order(order).then(must);
  const [ingredients, medicines, presentations, aliases] = await Promise.all([q("ref_ingredients"), q("ref_medicines"), q("ref_presentations"), q("ref_aliases")]);
  const rows = { ingredients, medicines, presentations, aliases };
  if (canSeeCommercial) {
    [rows.priceVersions, rows.agreements, rows.agreementVersions, rows.spend] = await Promise.all([q("price_versions"), q("agreements"), q("agreement_versions"), q("spend_entries")]);
  }
  return ecoFromRows(rows, { canSeeCommercial });
}
// Orden por dependencias: principios activos → medicamentos → presentaciones → alias → precios → acuerdos → gasto.
export async function pushEco(d) {
  const c = client();
  if (d.ingredients.length) must(await c.from("ref_ingredients").insert(d.ingredients));
  if (d.medicines.length) must(await c.from("ref_medicines").upsert(d.medicines));
  if (d.presentations.length) must(await c.from("ref_presentations").upsert(d.presentations));
  if (d.aliases.length) must(await c.from("ref_aliases").insert(d.aliases));
  if (d.newVersions.length) must(await c.from("price_versions").insert(d.newVersions));
  for (const x of d.closures) must(await c.from("price_versions").update({ valid_to: x.valid_to }).eq("id", x.id).is("valid_to", null).select("id"));
  if (d.agInserts.length) must(await c.from("agreements").insert(d.agInserts));
  for (const u of d.agUpdates) {
    const { id, ...rest } = u.row;
    const r = must(await c.from("agreements").update(rest).eq("id", id).eq("version", u.expected).select("id"));
    if (!r.length) { const e = new Error("Conflicto de versión: el acuerdo " + id + " ha cambiado en la nube."); e.code = "40001"; throw e; }
  }
  if (d.spend.length) must(await c.from("spend_entries").insert(d.spend));
}
// Anulaciones (migración 004): solo revisor/admin. Si no se anula ninguna fila (sin permiso o ya anulada por otra persona) se avisa.
// La base fija autor y fecha; aquí solo se envía el motivo.
export async function pushVoids({ versions = [], spend = [], history = [] }) {
  const c = client();
  const run = async (table, id, reason) => {
    const r = must(await c.from(table).update({ voided_at: new Date().toISOString(), void_reason: reason }).eq("id", id).is("voided_at", null).select("id"));
    if (!r.length) throw new Error("No se pudo anular el registro " + id + " en la nube (¿ya estaba anulado o tu rol no lo permite?).");
  };
  for (const x of versions) await run("price_versions", x.id, x.reason);
  for (const x of history) await run("price_history", x.id, x.reason);
  for (const x of spend) await run("spend_entries", x.id, x.reason);
}
export function subscribe(onChange) {
  const c = client();
  const ch = c.channel("comparafar-sync");
  for (const t of ["catalog_items", "price_history", "schemes", ...(CLOUD.eco ? ["ref_medicines", "ref_presentations", "price_versions", "agreements", "spend_entries"] : [])]) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, onChange);
  ch.subscribe();
  return () => { c.removeChannel(ch); };
}
export async function pullAudit(limit = 200) {
  return must(await client().from("audit_log").select("*").order("id", { ascending: false }).limit(limit));
}
export { isConflict, itemToRow, priceToRow };
