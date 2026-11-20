-- Comparafar · migración 003 · módulos económicos (catálogo de medicamentos, precios versionados, acuerdos de gasto)
-- ADITIVA: solo crea tablas, funciones y políticas nuevas; no modifica ni borra nada de 001/002. Idempotente.
-- NO aplicar en producción sin revisión: ejecutar primero en una rama o proyecto de pruebas (ver LEEME.md).
-- Privacidad: aquí NO hay planes importados, estimaciones ni contexto de paciente (se quedan en el navegador, como los pacientes).
-- Las condiciones comerciales (precios diferenciados por centro/condición, acuerdos y gasto registrado) solo las ven editor, revisor y admin.

-- 1) Catálogo de referencia: principio activo → medicamento → presentación -------------------------------
create table if not exists public.ref_ingredients (
  id text primary key,
  name text not null,
  name_norm text not null unique,
  source jsonb not null default '{}'::jsonb,           -- {kind: manual|cima|excel, nregistro, consultedAt…}
  cima jsonb,                                          -- {id, codigo} oficiales cuando constan
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.ref_medicines (
  id text primary key,
  name text not null,
  nregistro text unique,                               -- nº de registro CIMA (puede ser alfanumérico)
  labtitular text,
  forma text,
  atc jsonb,
  ingredients jsonb not null check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) >= 1), -- varios principios activos
  source jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ref_presentations (
  id text primary key,
  medicine_id text not null references public.ref_medicines(id),
  cn text unique check (cn is null or cn ~ '^[0-9]{6,7}$'),   -- código nacional SIEMPRE como texto
  label text not null,
  content jsonb,                                       -- {count, unit, volume:{amount,unit}}
  conversion jsonb,                                    -- {mgPerUnit, basis, verified}: equivalencia explícita mg por unidad
  oral boolean not null default false,
  source jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ref_aliases (          -- alias de Oncofar, solo con confirmación del usuario
  id text primary key,
  alias text not null,
  alias_norm text not null unique,
  ingredient_id text not null,                         -- id de ref_ingredients o «legacy:<código>» del catálogo heredado
  confirmed_by uuid default auth.uid(),
  confirmed_at timestamptz not null default now()
);

-- 2) Versiones de precio (solo se añaden; únicamente se puede cerrar la vigencia abierta) -------------------
create table if not exists public.price_versions (
  id text primary key,
  presentation_id text not null,                       -- catalog_items.id (heredado) o ref_presentations.id
  center text not null default '',
  condition text not null default 'general',
  price_units bigint not null check (price_units > 0), -- 1 unidad = 0,0001 €
  currency text not null default 'EUR' check (currency = 'EUR'),
  purchase_unit text not null check (purchase_unit in ('envase','vial','unidad','caja')),
  content_per_unit int not null check (content_per_unit >= 1),
  vat_mode text not null check (vat_mode in ('sin_iva','iva_incluido','no_especificado')),
  vat_rate numeric check (vat_rate is null or (vat_rate > 0 and vat_rate < 1)),
  source text not null check (length(trim(source)) > 0),
  valid_from date not null,
  valid_to date check (valid_to is null or valid_to >= valid_from),
  price_type text, note text,
  origin text not null default 'manual',
  closed_by uuid, closed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists price_versions_pres_idx on public.price_versions (presentation_id, center, condition);

create or replace function public.trg_price_versions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.price_versions v
               where v.presentation_id = new.presentation_id and v.center = new.center and v.condition = new.condition
                 and v.valid_from <= coalesce(new.valid_to, date '9999-12-31') and new.valid_from <= coalesce(v.valid_to, date '9999-12-31')) then
      raise exception 'La vigencia se solapa con otra versión de precio de la misma presentación, centro y condición de compra.' using errcode = '23P01';
    end if;
    return new;
  end if;
  if old.valid_to is not null or new.valid_to is null or new.valid_to < old.valid_from
     or (to_jsonb(new) - array['valid_to','closed_by','closed_at']) is distinct from (to_jsonb(old) - array['valid_to','closed_by','closed_at']) then
    raise exception 'Las versiones de precio no se modifican: solo se puede cerrar la vigencia de una versión abierta.' using errcode = '42501';
  end if;
  new.closed_by := auth.uid(); new.closed_at := now();
  return new;
end $$;
drop trigger if exists price_versions_guard on public.price_versions;
create trigger price_versions_guard before insert or update on public.price_versions for each row execute function public.trg_price_versions_guard();

-- 3) Acuerdos y medidas de gasto, con histórico de versiones -----------------------------------------------------
create table if not exists public.agreements (
  id text primary key,
  version int not null default 1 check (version >= 1),
  type text not null check (type in ('techo','descuento','devolucion','volumen','otra')),
  title text not null,
  scope_level text not null check (scope_level in ('principio_activo','medicamento','presentacion')),
  scope_target text not null,
  data jsonb not null,                                 -- alcance acotado, periodo, vigencia, umbral, fórmula, orden, base, liquidación
  source text not null check (length(trim(source)) > 0),
  owner text not null,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now()
);
create table if not exists public.agreement_versions (
  id bigint generated always as identity primary key,
  agreement_id text not null, version int not null, data jsonb not null,
  changed_by uuid, changed_at timestamptz not null default now()
);
create or replace function public.trg_agreements_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and new.version <> old.version + 1 then
    raise exception 'Conflicto de versión: el acuerdo % lo ha modificado otra persona (versión actual %).', old.id, old.version using errcode = '40001';
  end if;
  return new;
end $$;
drop trigger if exists agreements_guard on public.agreements;
create trigger agreements_guard before insert or update on public.agreements for each row execute function public.trg_agreements_guard();

-- Gasto realizado registrado (acumulados fechados con procedencia) y ajustes/devoluciones efectivamente registrados. Solo se añade.
create table if not exists public.spend_entries (
  id text primary key,
  kind text not null check (kind in ('realizado','ajuste','devolucion')),
  agreement_id text,
  scope jsonb not null default '{}'::jsonb,
  from_date date, to_date date,
  as_of date not null,
  amount_cents bigint not null check (amount_cents > 0),
  source text not null check (length(trim(source)) > 0),
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

-- 4) Auditoría de quién modificó precios y acuerdos (reutiliza audit_log de 001) -------------------------------------
create or replace function public.trg_audit_eco() returns trigger
language plpgsql security definer set search_path = public as $$
declare ent text := tg_table_name; det jsonb;
begin
  if ent = 'price_versions' then det := jsonb_build_object('presentation', new.presentation_id, 'price_units', new.price_units, 'valid_from', new.valid_from, 'valid_to', new.valid_to, 'condition', new.condition, 'center', new.center, 'source', new.source);
  elsif ent = 'agreements' then
    det := jsonb_build_object('title', new.title, 'version', new.version, 'type', new.type);
    insert into public.agreement_versions (agreement_id, version, data, changed_by) values (new.id, new.version, new.data, auth.uid());
  elsif ent = 'spend_entries' then det := jsonb_build_object('kind', new.kind, 'amount_cents', new.amount_cents, 'as_of', new.as_of, 'source', new.source);
  else det := jsonb_build_object('name', coalesce(to_jsonb(new) ->> 'name', to_jsonb(new) ->> 'label'));
  end if;
  insert into public.audit_log (user_id, user_email, action, entity, entity_id, detail)
  values (auth.uid(), auth.jwt() ->> 'email', lower(tg_op), ent, new.id, det);
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['ref_ingredients','ref_medicines','ref_presentations','ref_aliases','price_versions','agreements','spend_entries'] loop
    execute format('drop trigger if exists audit_eco on public.%I', t);
    execute format('create trigger audit_eco after insert or update on public.%I for each row execute function public.trg_audit_eco()', t);
  end loop;
end $$;

-- 5) Seguridad por filas ------------------------------------------------------------------------------------------------
alter table public.ref_ingredients  enable row level security;
alter table public.ref_medicines    enable row level security;
alter table public.ref_presentations enable row level security;
alter table public.ref_aliases      enable row level security;
alter table public.price_versions   enable row level security;
alter table public.agreements       enable row level security;
alter table public.agreement_versions enable row level security;
alter table public.spend_entries    enable row level security;

do $$ declare t text; begin
  foreach t in array array['ref_ingredients','ref_medicines','ref_presentations','ref_aliases'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() is not null)', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.app_role() in (''editor'',''revisor'',''admin''))', t || '_insert', t);
  end loop;
end $$;
drop policy if exists ref_medicines_update on public.ref_medicines;
create policy ref_medicines_update on public.ref_medicines for update to authenticated using (public.app_role() in ('editor','revisor','admin')) with check (public.app_role() in ('editor','revisor','admin'));
drop policy if exists ref_presentations_update on public.ref_presentations;
create policy ref_presentations_update on public.ref_presentations for update to authenticated using (public.app_role() in ('editor','revisor','admin')) with check (public.app_role() in ('editor','revisor','admin'));

-- Precios generales: cualquier usuario activo. Condiciones diferenciadas (centro o condición ≠ general): editor, revisor y admin.
drop policy if exists price_versions_select on public.price_versions;
create policy price_versions_select on public.price_versions for select to authenticated
  using (public.app_role() in ('editor','revisor','admin') or (public.app_role() is not null and center = '' and condition = 'general'));
drop policy if exists price_versions_insert on public.price_versions;
create policy price_versions_insert on public.price_versions for insert to authenticated with check (public.app_role() in ('editor','revisor','admin'));
drop policy if exists price_versions_close on public.price_versions;
create policy price_versions_close on public.price_versions for update to authenticated using (public.app_role() in ('editor','revisor','admin')) with check (public.app_role() in ('editor','revisor','admin'));

-- Acuerdos y gasto registrado: solo editor, revisor y admin (condiciones comerciales confidenciales).
do $$ declare t text; begin
  foreach t in array array['agreements','agreement_versions','spend_entries'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() in (''editor'',''revisor'',''admin''))', t || '_select', t);
  end loop;
end $$;
drop policy if exists agreements_insert on public.agreements;
create policy agreements_insert on public.agreements for insert to authenticated with check (public.app_role() in ('editor','revisor','admin'));
drop policy if exists agreements_update on public.agreements;
create policy agreements_update on public.agreements for update to authenticated using (public.app_role() in ('editor','revisor','admin')) with check (public.app_role() in ('editor','revisor','admin'));
drop policy if exists spend_entries_insert on public.spend_entries;
create policy spend_entries_insert on public.spend_entries for insert to authenticated with check (public.app_role() in ('editor','revisor','admin'));

-- 6) Permisos explícitos: sin acceso anónimo, sin borrados, historiales inmutables --------------------------------------
revoke all on public.ref_ingredients, public.ref_medicines, public.ref_presentations, public.ref_aliases, public.price_versions, public.agreements, public.agreement_versions, public.spend_entries from anon, authenticated;  -- parte de cero: Supabase concede por defecto todos los privilegios (incl. TRUNCATE y UPDATE completo)
grant select, insert on public.ref_ingredients, public.ref_aliases to authenticated;
grant select, insert, update on public.ref_medicines, public.ref_presentations to authenticated;
grant select, insert on public.price_versions to authenticated;
grant update (valid_to) on public.price_versions to authenticated;       -- único cambio permitido: cerrar la vigencia
grant select, insert, update on public.agreements to authenticated;
grant select on public.agreement_versions to authenticated;
grant select, insert on public.spend_entries to authenticated;
revoke delete on public.ref_ingredients, public.ref_medicines, public.ref_presentations, public.ref_aliases, public.price_versions, public.agreements, public.agreement_versions, public.spend_entries from authenticated;
revoke execute on function public.trg_price_versions_guard(), public.trg_agreements_guard(), public.trg_audit_eco() from public, anon, authenticated;
