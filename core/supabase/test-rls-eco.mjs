// Prueba de 003_modulos_economicos.sql con pglite (stub de auth de Supabase). No sustituye una prueba real en una rama de Supabase.
// Uso:  npm i --no-save @electric-sql/pglite   (en modules/mieloma)  y   node core/supabase/test-rls-eco.mjs
import { createRequire } from "module"; import fs from "fs"; import path from "path";
const here = import.meta.dirname; const require = createRequire(path.resolve(here, "../../modules/mieloma/package.json"));
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
create publication supabase_realtime; grant usage on schema auth to anon, authenticated; grant usage on schema public to anon;`);
const sql = (f) => fs.readFileSync(path.join(here, f), "utf8");
await db.exec(sql("001_schema.sql")); await db.exec(sql("002_seed_catalog.sql"));
await db.exec(sql("003_modulos_economicos.sql")); await db.exec(sql("003_modulos_economicos.sql")); // idempotente
const ids = {};
for (const n of ["admin", "editor", "lector", "revisor"]) ids[n] = (await db.query("insert into auth.users(email) values ($1) returning id", [n + "@x.es"])).rows[0].id;
await db.exec("update profiles set role='admin' where email='admin@x.es'; update profiles set role='editor' where email='editor@x.es'; update profiles set role='revisor' where email='revisor@x.es';");
const as = async (who, q, params = []) => { await db.exec("reset role;"); if (who === "anon") await db.exec("set role anon;"); else { await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.email',$2,false)", [ids[who], who + "@x.es"]); await db.exec("set role authenticated;"); } try { const r = await db.query(q, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, err: e.message }; } };
let bad = 0; const t = (n, c, extra) => { console.log((c ? "OK  " : "FALLO") + " " + n + (c ? "" : " " + (extra || ""))); if (!c) bad++; };
const pv = (id, extra = {}) => { const o = { id, pres: "C03", center: "", condition: "general", price: 200000, from: "2026-12-01", to: null, ...extra }; return [`insert into price_versions(id,presentation_id,center,condition,price_units,purchase_unit,content_per_unit,vat_mode,source,valid_from,valid_to) values ($1,$2,$3,$4,$5,'vial',1,'sin_iva','Contrato X',$6,$7)`, [o.id, o.pres, o.center, o.condition, o.price, o.from, o.to]]; };

t("migración idempotente y aditiva: 001/002 intactos (22 presentaciones heredadas)", (await as("lector", "select count(*)::int c from catalog_items")).rows[0].c === 22);
// precios versionados
t("lector no inserta versiones de precio", !(await as("lector", ...pv("V0"))).ok);
t("editor inserta versión general", (await as("editor", ...pv("V1", { from: "2026-12-01", to: "2026-12-31" }))).ok);
const ov = await as("editor", ...pv("V2", { from: "2026-12-15", to: "2027-01-10" })); t("vigencias solapadas rechazadas", !ov.ok && /solapa/.test(ov.err), ov.err);
t("misma presentación con otra condición no se solapa", (await as("editor", ...pv("V3", { from: "2026-12-15", condition: "acuerdo-volumen", price: 170000 }))).ok);
t("otro centro tampoco", (await as("editor", ...pv("V4", { from: "2026-12-15", center: "Hospital B", price: 180000 }))).ok);
t("versión contigua (sin hueco ni solape) permitida", (await as("editor", ...pv("V5", { from: "2027-01-01" }))).ok);
t("lector ve el precio general pero no las condiciones comerciales", (await as("lector", "select count(*)::int c from price_versions")).rows[0].c === 2 && (await as("lector", "select count(*)::int c from price_versions where condition<>'general' or center<>''")).rows[0].c === 0);
t("editor ve las condiciones comerciales", (await as("editor", "select count(*)::int c from price_versions")).rows[0].c === 4);
t("precio sin fuente rechazado", !(await as("editor", `insert into price_versions(id,presentation_id,price_units,purchase_unit,content_per_unit,vat_mode,source,valid_from) values ('VX','C04',1,'vial',1,'sin_iva','  ','2026-01-01')`)).ok);
t("no se modifica un precio", !(await as("editor", "update price_versions set price_units=1 where id='V5'")).ok);
t("no se borra", !(await as("editor", "delete from price_versions")).ok);
t("se puede cerrar una vigencia abierta una sola vez", (await as("editor", "update price_versions set valid_to='2027-06-30' where id='V5' returning id")).rows.length === 1 && !(await as("editor", "update price_versions set valid_to='2027-07-30' where id='V5'")).ok);
// acuerdos
t("lector no ve acuerdos", (await as("lector", "select count(*)::int c from agreements")).rows[0].c === 0);
t("lector no crea acuerdos", !(await as("lector", `insert into agreements(id,type,title,scope_level,scope_target,data,source,owner) values ('A1','techo','x','principio_activo','legacy:bort','{}','s','o')`)).ok);
t("editor crea acuerdo v1", (await as("editor", `insert into agreements(id,type,title,scope_level,scope_target,data,source,owner) values ('A1','techo','Techo','principio_activo','legacy:bort','{"threshold":1}','Contrato','Jefa')`)).ok);
t("editor actualiza a v2", (await as("editor", `update agreements set version=2, data='{"threshold":2}' where id='A1' and version=1 returning id`)).rows.length === 1);
t("conflicto de versión detectado", !(await as("editor", "update agreements set version=5 where id='A1'")).ok);
t("histórico de versiones del acuerdo", (await as("editor", "select count(*)::int c from agreement_versions where agreement_id='A1'")).rows[0].c === 2);
t("lector no ve el histórico", (await as("lector", "select count(*)::int c from agreement_versions")).rows[0].c === 0);
t("gasto registrado solo se añade", (await as("editor", `insert into spend_entries(id,kind,scope,as_of,amount_cents,source) values ('E1','realizado','{}','2026-10-31',120000,'Informe contable')`)).ok && !(await as("editor", "update spend_entries set amount_cents=1")).ok && !(await as("editor", "delete from spend_entries")).ok);
t("gasto sin procedencia rechazado", !(await as("editor", `insert into spend_entries(id,kind,as_of,amount_cents,source) values ('E2','realizado','2026-10-31',5,'')`)).ok);
t("lector no ve el gasto registrado", (await as("lector", "select count(*)::int c from spend_entries")).rows[0].c === 0);
t("anon no accede a nada", !(await as("anon", "select * from price_versions")).ok && !(await as("anon", "select * from agreements")).ok);
// catálogo de referencia
t("editor crea principio activo, medicamento con 2 principios y presentación", (await as("editor", `insert into ref_ingredients(id,name,name_norm) values ('PA1','Lopinavir','lopinavir'),('PA2','Ritonavir','ritonavir')`)).ok && (await as("editor", `insert into ref_medicines(id,name,ingredients) values ('M1','Kaletra','[{"ingredientId":"PA1"},{"ingredientId":"PA2"}]')`)).ok && (await as("editor", `insert into ref_presentations(id,medicine_id,cn,label) values ('P1','M1','0123456','Kaletra 60 comp')`)).ok);
t("el código nacional es texto de 6-7 dígitos (conserva el 0 inicial)", (await as("lector", "select cn from ref_presentations where id='P1'")).rows[0].cn === "0123456" && !(await as("editor", `insert into ref_presentations(id,medicine_id,cn,label) values ('P2','M1','12','x')`)).ok);
t("CN único", !(await as("editor", `insert into ref_presentations(id,medicine_id,cn,label) values ('P3','M1','0123456','dup')`)).ok);
t("medicamento sin principios activos rechazado", !(await as("editor", `insert into ref_medicines(id,name,ingredients) values ('M2','x','[]')`)).ok);
t("lector lee el catálogo pero no lo escribe", (await as("lector", "select count(*)::int c from ref_ingredients")).rows[0].c === 2 && !(await as("lector", `insert into ref_ingredients(id,name,name_norm) values ('PA9','x','x')`)).ok);
t("alias único por texto normalizado", (await as("editor", `insert into ref_aliases(id,alias,alias_norm,ingredient_id) values ('AL1','LOPINAVIR EFG','lopinavir efg','PA1')`)).ok && !(await as("editor", `insert into ref_aliases(id,alias,alias_norm,ingredient_id) values ('AL2','x','lopinavir efg','PA2')`)).ok);
// auditoría
const au = await as("admin", "select user_email, entity from audit_log where entity in ('price_versions','agreements','spend_entries') order by id");
t("auditoría registra al editor en precios, acuerdos y gasto", au.rows.length >= 5 && au.rows.every((r) => r.user_email === "editor@x.es") && ["price_versions", "agreements", "spend_entries"].every((e) => au.rows.some((r) => r.entity === e)));
console.log(bad ? `\n${bad} fallo(s)` : "\nRLS de módulos económicos correcto"); process.exit(bad ? 1 : 0);
