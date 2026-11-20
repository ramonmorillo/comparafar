-- Comparafar · esquema inicial (datos de referencia compartidos)
-- Ejecutar UNA vez en Supabase > SQL Editor del proyecto «comparafar».
-- Sin datos de pacientes. Acceso solo para usuarios autenticados con perfil activo.
-- Roles: lector (solo ver), editor (crear/modificar), revisor (además verificar), admin (todo, gestiona perfiles).

-- 1) Perfiles y roles ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'lector' check (role in ('lector','editor','revisor','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rol del usuario actual (null si no tiene perfil activo)
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- 2) Catálogo de costes (presentaciones) y su historial de precios (solo se añade) -----
create table if not exists public.catalog_items (
  id text primary key,
  drug text not null,
  label text not null,
  mg numeric check (mg is null or mg > 0),
  unit text,
  oral boolean not null default false,
  route text,
  center text,
  excel_cell text,
  status text not null default 'pendiente' check (status in ('pendiente','verificado')),
  archived boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  item_id text not null references public.catalog_items(id),
  price numeric not null check (price > 0),
  price_type text not null default 'No especificado en el Excel',
  valid_from date,
  source text not null check (length(trim(source)) > 0),
  note text,
  added_at timestamptz not null default now(),
  added_by uuid default auth.uid()
);
create index if not exists price_history_item_idx on public.price_history (item_id);

-- 3) Esquemas (propios y modificaciones de los importados) con historial de versiones --
create table if not exists public.schemes (
  id text primary key,
  name text not null,
  line text not null,
  version int not null default 1 check (version >= 1),
  status text not null default 'borrador',
  archived boolean not null default false,
  verified jsonb,
  data jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.scheme_versions (
  id bigint generated always as identity primary key,
  scheme_id text not null,
  version int not null,
  data jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  user_id uuid,
  user_email text,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb
);

-- 4) Triggers: control de versión, verificación restringida, historial y auditoría --------
create or replace function public.trg_schemes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.app_role();
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    if new.version <> old.version + 1 then
      raise exception 'Conflicto de versión: el esquema % lo ha modificado otra persona (versión actual %).', old.id, old.version using errcode = '40001';
    end if;
    if old.status = 'verificado'
       and (new.data - array['archived','version','status','verified']) is distinct from (old.data - array['archived','version','status','verified'])
       and coalesce(r,'') not in ('revisor','admin') then
      raise exception 'Un esquema verificado solo puede modificarlo un revisor o administrador.';
    end if;
  end if;
  if new.status = 'verificado' and (tg_op = 'INSERT' or old.status is distinct from 'verificado')
     and coalesce(r,'') not in ('revisor','admin') then
    raise exception 'Solo un revisor o administrador puede marcar un esquema como verificado.';
  end if;
  return new;
end $$;

drop trigger if exists schemes_guard on public.schemes;
create trigger schemes_guard before insert or update on public.schemes
  for each row execute function public.trg_schemes_guard();

create or replace function public.trg_catalog_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'verificado' and (tg_op = 'INSERT' or old.status is distinct from 'verificado')
     and coalesce(public.app_role(),'') not in ('revisor','admin') then
    raise exception 'Solo un revisor o administrador puede verificar una presentación.';
  end if;
  return new;
end $$;

drop trigger if exists catalog_guard on public.catalog_items;
create trigger catalog_guard before insert or update on public.catalog_items
  for each row execute function public.trg_catalog_guard();

create or replace function public.trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare ent text := tg_table_name; eid text; det jsonb;
begin
  if ent = 'schemes' then
    eid := new.id;
    det := jsonb_build_object('version', new.version, 'status', new.status, 'archived', new.archived, 'name', new.name);
    insert into public.scheme_versions (scheme_id, version, data, changed_by) values (new.id, new.version, new.data, auth.uid());
  elsif ent = 'price_history' then
    eid := new.item_id;
    det := jsonb_build_object('price', new.price, 'type', new.price_type, 'valid_from', new.valid_from, 'source', new.source);
  else
    eid := new.id;
    det := jsonb_build_object('label', new.label, 'archived', new.archived, 'status', new.status);
  end if;
  insert into public.audit_log (user_id, user_email, action, entity, entity_id, detail)
  values (auth.uid(), auth.jwt() ->> 'email', lower(tg_op), ent, eid, det);
  return new;
end $$;

drop trigger if exists audit_schemes on public.schemes;
create trigger audit_schemes after insert or update on public.schemes for each row execute function public.trg_audit();
drop trigger if exists audit_prices on public.price_history;
create trigger audit_prices after insert on public.price_history for each row execute function public.trg_audit();
drop trigger if exists audit_catalog on public.catalog_items;
create trigger audit_catalog after insert or update on public.catalog_items for each row execute function public.trg_audit();

-- 5) Seguridad por filas (RLS) -----------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.catalog_items  enable row level security;
alter table public.price_history  enable row level security;
alter table public.schemes        enable row level security;
alter table public.scheme_versions enable row level security;
alter table public.audit_log      enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() = 'admin');
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

drop policy if exists catalog_select on public.catalog_items;
create policy catalog_select on public.catalog_items for select to authenticated using (public.app_role() is not null);
drop policy if exists catalog_insert on public.catalog_items;
create policy catalog_insert on public.catalog_items for insert to authenticated with check (public.app_role() in ('editor','revisor','admin'));
drop policy if exists catalog_update on public.catalog_items;
create policy catalog_update on public.catalog_items for update to authenticated
  using (public.app_role() in ('editor','revisor','admin')) with check (public.app_role() in ('editor','revisor','admin'));

drop policy if exists price_select on public.price_history;
create policy price_select on public.price_history for select to authenticated using (public.app_role() is not null);
drop policy if exists price_insert on public.price_history;
create policy price_insert on public.price_history for insert to authenticated with check (public.app_role() in ('editor','revisor','admin'));

drop policy if exists schemes_select on public.schemes;
create policy schemes_select on public.schemes for select to authenticated using (public.app_role() is not null);
drop policy if exists schemes_insert on public.schemes;
create policy schemes_insert on public.schemes for insert to authenticated with check (public.app_role() in ('editor','revisor','admin'));
drop policy if exists schemes_update on public.schemes;
create policy schemes_update on public.schemes for update to authenticated
  using (public.app_role() in ('editor','revisor','admin')) with check (public.app_role() in ('editor','revisor','admin'));

drop policy if exists versions_select on public.scheme_versions;
create policy versions_select on public.scheme_versions for select to authenticated using (public.app_role() is not null);

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (public.app_role() in ('revisor','admin'));

-- 6) Permisos: sin acceso anónimo; sin borrados; historiales inmutables ------------------------
revoke all on all tables in schema public from anon;
-- Permisos explícitos (los proyectos nuevos de Supabase no los conceden por defecto a las tablas de public)
grant usage on schema public to authenticated;
grant select on public.profiles, public.catalog_items, public.price_history, public.schemes, public.scheme_versions, public.audit_log to authenticated;
grant insert, update on public.catalog_items, public.schemes to authenticated;
grant insert on public.price_history to authenticated;
revoke delete on all tables in schema public from authenticated;
-- TRUNCATE no pasa por RLS (y REFERENCES/TRIGGER no hacen falta): se retiran para que ningún rol de la app pueda vaciar tablas ni la auditoría.
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke update on public.price_history, public.scheme_versions, public.audit_log from authenticated;
revoke insert on public.scheme_versions, public.audit_log from authenticated;
revoke insert, update on public.profiles from authenticated;
grant update (role, active, full_name) on public.profiles to authenticated; -- la política RLS limita esto a administradores

revoke execute on function public.app_role() from public, anon;
grant execute on function public.app_role() to authenticated;
revoke execute on function public.handle_new_user(), public.trg_schemes_guard(), public.trg_catalog_guard(), public.trg_audit() from public, anon, authenticated;
-- Supabase Auth ejecuta este disparador al crear un usuario: necesita permiso (si no, no se puede crear el usuario).
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- 7) Tiempo real para ver los cambios de otras personas ---------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.catalog_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.price_history; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.schemes; exception when duplicate_object then null; end;
end $$;

-- 8) PRIMER ADMINISTRADOR (ejecutar después de crear tu usuario en Authentication > Users):
-- update public.profiles set role = 'admin' where email = 'TU_CORREO@EJEMPLO.ES';
