import { PGlite } from "@electric-sql/pglite"; import fs from "fs";
const db = new PGlite();
const stub = `
create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
create publication supabase_realtime;
grant usage on schema auth to anon, authenticated; grant usage on schema public to anon;
`;
await db.exec(stub);
await db.exec(fs.readFileSync("/home/claude/comparafar/core/supabase/001_schema.sql","utf8"));
await db.exec(fs.readFileSync("/home/claude/comparafar/core/supabase/002_seed_catalog.sql","utf8"));
await db.exec(fs.readFileSync("/home/claude/comparafar/core/supabase/002_seed_catalog.sql","utf8")); // idempotente
const ids={};
for (const [n,r] of [["admin","admin"],["editor","editor"],["lector","lector"],["revisor","revisor"],["fuera","lector"]]) {
  const x = await db.query("insert into auth.users(email) values ($1) returning id",[n+"@x.es"]); ids[n]=x.rows[0].id;
}
await db.exec("update profiles set role='admin' where email='admin@x.es'; update profiles set role='editor' where email='editor@x.es'; update profiles set role='revisor' where email='revisor@x.es'; update profiles set active=false where email='fuera@x.es';");
const as = async (who, sql, params=[]) => { 
  await db.exec("reset role;"); 
  if (who==="anon") await db.exec("set role anon;"); else { await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.email',$2,false)",[ids[who],who+"@x.es"]); await db.exec("set role authenticated;"); }
  try { const r = await db.query(sql, params); return { ok:true, rows:r.rows, n:r.affectedRows }; } catch(e){ return { ok:false, err:e.message }; }
};
const t=(name,cond)=>{ console.log((cond?"OK  ":"FALLO")+" "+name); if(!cond) process.exitCode=1; };
let r;
console.log("items", (await as("lector","select count(*)::int c from catalog_items")).rows[0].c, "precios", (await as("lector","select count(*)::int c from price_history")).rows[0].c);
t("lector ve el catálogo", (await as("lector","select count(*)::int c from catalog_items")).rows[0].c===22);
t("semilla idempotente (20 precios)", (await as("lector","select count(*)::int c from price_history")).rows[0].c===20);
t("anon no ve nada", !(await as("anon","select * from catalog_items")).ok);
t("usuario inactivo no ve filas", (await as("fuera","select count(*)::int c from catalog_items")).rows[0].c===0);
t("lector no inserta precio", !(await as("lector","insert into price_history(item_id,price,source) values ('C03',20,'x')")).ok);
t("editor inserta precio", (await as("editor","insert into price_history(item_id,price,source,valid_from) values ('C03',20,'Contrato 2026','2026-12-01')")).ok);
t("editor no inserta precio sin fuente", !(await as("editor","insert into price_history(item_id,price,source) values ('C03',21,'  ')")).ok);
t("editor no puede modificar historial", !(await as("editor","update price_history set price=1")).ok);
t("editor no puede borrar", !(await as("editor","delete from price_history")).ok);
r = await as("admin","select user_email, action, entity from audit_log order by id desc limit 1"); t("auditoría registra al editor", r.rows[0]&&r.rows[0].user_email==="editor@x.es"&&r.rows[0].entity==="price_history");
t("editor no lee auditoría", (await as("editor","select count(*)::int c from audit_log")).rows[0].c===0);
t("editor crea esquema v1", (await as("editor","insert into schemes(id,name,line,version,status,data) values ('S1','Prueba','1N',1,'borrador','{\"a\":1,\"version\":1}')")).ok);
t("editor actualiza a v2", (await as("editor","update schemes set version=2, data='{\"a\":2,\"version\":2}' where id='S1' and version=1 returning id")).rows.length===1);
t("conflicto de versión detectado", !(await as("editor","update schemes set version=5 where id='S1'")).ok);
t("update con versión vieja no afecta filas", (await as("editor","update schemes set version=3 where id='S1' and version=1 returning id")).rows.length===0);
t("editor no verifica", !(await as("editor","update schemes set version=3, status='verificado' where id='S1' and version=2")).ok);
t("revisor verifica", (await as("revisor","update schemes set version=3, status='verificado', verified='{\"reviewer\":\"r\"}' where id='S1' and version=2 returning id")).rows.length===1);
t("editor no cambia datos de verificado", !(await as("editor","update schemes set version=4, data='{\"a\":9}' where id='S1' and version=3")).ok);
t("editor sí puede archivar verificado", (await as("editor","update schemes set version=4, archived=true, data = data || '{\"archived\":true}' where id='S1' and version=3 returning id")).rows.length===1);
t("historial de versiones (4)", (await as("lector","select count(*)::int c from scheme_versions where scheme_id='S1'")).rows[0].c===4);
t("lector no crea esquema", !(await as("lector","insert into schemes(id,name,line,data) values ('S2','x','1N','{}')")).ok);
t("editor no cambia su rol", (await as("editor","update profiles set role='admin' where id=(select auth.uid()) returning id")).rows.length===0);
t("admin cambia roles", (await as("admin","update profiles set role='editor' where email='lector@x.es' returning id")).rows.length===1);
t("editor ve solo su perfil", (await as("editor","select count(*)::int c from profiles")).rows[0].c===1);
t("editor crea presentación", (await as("editor","insert into catalog_items(id,drug,label,mg) values ('U1','bort','Bortezomib 1 mg',1)")).ok);
t("editor no verifica presentación", !(await as("editor","update catalog_items set status='verificado' where id='U1'")).ok);
t("rol de lector ahora editor puede insertar", (await as("lector","insert into catalog_items(id,drug,label,mg) values ('U2','bort','x',1)")).ok);
