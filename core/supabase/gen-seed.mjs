// Genera 002_seed_catalog.sql a partir de los datos importados del Excel (modules/mieloma/src/data.js).
// Uso: node core/supabase/gen-seed.mjs > core/supabase/002_seed_catalog.sql
import { CATALOG_INITIAL } from "../../modules/mieloma/src/data.js";
const q = (v) => (v == null ? "null" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const out = ["-- Catálogo inicial importado del Excel «Mielola multiple costes 2026» (hoja Costes).", "-- Precios SIN verificar; tipo de precio no especificado en el Excel. Idempotente: puede ejecutarse más de una vez.", ""];
for (const c of CATALOG_INITIAL) {
  out.push(`insert into public.catalog_items (id, drug, label, mg, unit, oral, route, center, excel_cell, status, archived) values (${[c.id, c.drug, c.label, c.mg, c.unit, c.oral, c.route, c.center, c.excelCell, c.status].map((v) => (typeof v === "boolean" ? v : q(v))).join(", ")}, false) on conflict (id) do nothing;`);
  for (const h of c.history) {
    out.push(`insert into public.price_history (item_id, price, price_type, valid_from, source, note) select ${q(c.id)}, ${h.price}, ${q(h.type)}, ${q(h.from)}, ${q(h.source)}, ${q(h.note || null)} where not exists (select 1 from public.price_history where item_id = ${q(c.id)} and source = ${q(h.source)});`);
  }
}
console.log(out.join("\n"));
