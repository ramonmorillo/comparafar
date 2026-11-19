import { createClient } from "@supabase/supabase-js";
import { CLOUD } from "./cloudConfig.js";
import { rowsToCatalog, itemToRow, priceToRow, schemeToRow, rowToScheme, isConflict } from "./cloudMap.js";

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
export function subscribe(onChange) {
  const c = client();
  const ch = c.channel("comparafar-sync");
  for (const t of ["catalog_items", "price_history", "schemes"]) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, onChange);
  ch.subscribe();
  return () => { c.removeChannel(ch); };
}
export async function pullAudit(limit = 200) {
  return must(await client().from("audit_log").select("*").order("id", { ascending: false }).limit(limit));
}
export { isConflict, itemToRow, priceToRow };
