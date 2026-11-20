-- Comparafar · migración 004 · anulaciones (precios y gasto registrado)
-- Requiere 001 y 003. ADITIVA e idempotente: solo añade columnas, funciones, políticas y permisos; no borra ni cambia datos existentes.
-- NO aplicar en producción sin revisión (ver LEEME.md).
-- Idea: los registros económicos no se borran. Se ANULAN: quedan en el histórico con motivo obligatorio, autor y fecha, y dejan de computar.
-- Solo revisor y admin pueden anular. Una anulación no se deshace ni modifica ningún otro campo (se corrige creando un registro nuevo).
-- Tablas: price_versions y spend_entries (003) y price_history (001): esta última porque Costes refleja en ella los precios generales
-- para que la Calculadora y el motor heredado vean el mismo precio; anular uno sin el otro dejaría el precio anulado en la Calculadora.

-- 1) Columnas ------------------------------------------------------------------------------------------------------
alter table public.price_versions add column if not exists voided_at timestamptz, add column if not exists voided_by uuid, add column if not exists void_reason text;
alter table public.spend_entries  add column if not exists voided_at timestamptz, add column if not exists voided_by uuid, add column if not exists void_reason text;
alter table public.price_history  add column if not exists voided_at timestamptz, add column if not exists voided_by uuid, add column if not exists void_reason text;

do $$ declare t text; begin
  foreach t in array array['price_versions','spend_entries','price_history'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_void_chk' and conrelid = ('public.' || t)::regclass) then
      execute format('alter table public.%I add constraint %I check (voided_at is null or (voided_by is not null and void_reason is not null and length(trim(void_reason)) > 0))', t, t || '_void_chk');
    end if;
  end loop;
end $$;

-- 2) Guarda común: solo se anula (una vez), por revisor o admin, con motivo, sin tocar otros campos ---------------------------
create or replace function public.trg_void_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare ign text[] := array['voided_at','voided_by','void_reason'];
begin
  if tg_op = 'INSERT' then
    if new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then
      raise exception 'Un registro nuevo no puede nacer anulado.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'Un registro anulado no se modifica.' using errcode = '42501';
  end if;
  if new.voided_at is not null then
    if public.app_role() is null or public.app_role() not in ('revisor','admin') then
      raise exception 'Solo revisor o administrador pueden anular.' using errcode = '42501';
    end if;
    if new.void_reason is null or length(trim(new.void_reason)) = 0 then
      raise exception 'El motivo de anulación es obligatorio.' using errcode = '23514';
    end if;
    if (to_jsonb(new) - ign) is distinct from (to_jsonb(old) - ign) then
      raise exception 'Al anular no se puede modificar ningún otro campo.' using errcode = '42501';
    end if;
    new.voided_at := now(); new.voided_by := auth.uid();
  elsif new.voided_by is not null or new.void_reason is not null then
    raise exception 'Datos de anulación sin anular el registro.' using errcode = '42501';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['price_versions','spend_entries','price_history'] loop
    execute format('drop trigger if exists void_guard on public.%I', t);
    execute format('create trigger void_guard before insert or update on public.%I for each row execute function public.trg_void_guard()', t);
  end loop;
end $$;

-- 3) La guarda de precios (003) deja pasar la anulación y no cuenta las versiones anuladas como solapadas ----------------------
create or replace function public.trg_price_versions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.price_versions v
               where v.voided_at is null
                 and v.presentation_id = new.presentation_id and v.center = new.center and v.condition = new.condition
                 and v.valid_from <= coalesce(new.valid_to, date '9999-12-31') and new.valid_from <= coalesce(v.valid_to, date '9999-12-31')) then
      raise exception 'La vigencia se solapa con otra versión de precio de la misma presentación, centro y condición de compra.' using errcode = '23P01';
    end if;
    return new;
  end if;
  if new.voided_at is not null and old.voided_at is null then return new; end if;   -- anulación: la valida trg_void_guard
  if old.valid_to is not null or new.valid_to is null or new.valid_to < old.valid_from
     or (to_jsonb(new) - array['valid_to','closed_by','closed_at']) is distinct from (to_jsonb(old) - array['valid_to','closed_by','closed_at']) then
    raise exception 'Las versiones de precio no se modifican: solo se puede cerrar la vigencia de una versión abierta.' using errcode = '42501';
  end if;
  new.closed_by := auth.uid(); new.closed_at := now();
  return new;
end $$;

-- 4) Auditoría: las anulaciones quedan registradas con su motivo ------------------------------------------------------------
create or replace function public.trg_audit_void() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (user_id, user_email, action, entity, entity_id, detail)
  values (auth.uid(), auth.jwt() ->> 'email', 'anular', tg_table_name, coalesce(to_jsonb(new) ->> 'id', ''), jsonb_build_object('reason', new.void_reason));
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['price_versions','spend_entries','price_history'] loop
    execute format('drop trigger if exists audit_void on public.%I', t);
    execute format('create trigger audit_void after update on public.%I for each row when (old.voided_at is null and new.voided_at is not null) execute function public.trg_audit_void()', t);
  end loop;
end $$;
-- audit_eco (003) no duplica la entrada de una anulación
create or replace function public.trg_audit_eco() returns trigger
language plpgsql security definer set search_path = public as $$
declare ent text := tg_table_name; det jsonb;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) ->> 'voided_at') is distinct from (to_jsonb(old) ->> 'voided_at') then return new; end if;
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

-- 5) Seguridad por filas y permisos ------------------------------------------------------------------------------------------
-- Un lector no ve anulados (ni sus motivos); editor, revisor y admin sí (histórico).
drop policy if exists price_select on public.price_history;
create policy price_select on public.price_history for select to authenticated
  using (public.app_role() in ('editor','revisor','admin') or (public.app_role() is not null and voided_at is null));
drop policy if exists price_versions_select on public.price_versions;
create policy price_versions_select on public.price_versions for select to authenticated
  using (public.app_role() in ('editor','revisor','admin') or (public.app_role() is not null and center = '' and condition = 'general' and voided_at is null));
-- Anular: UPDATE solo de las tres columnas y solo revisor/admin (la guarda lo comprueba también)
drop policy if exists price_history_void on public.price_history;
create policy price_history_void on public.price_history for update to authenticated using (public.app_role() in ('revisor','admin')) with check (public.app_role() in ('revisor','admin'));
drop policy if exists spend_entries_void on public.spend_entries;
create policy spend_entries_void on public.spend_entries for update to authenticated using (public.app_role() in ('revisor','admin')) with check (public.app_role() in ('revisor','admin'));
grant update (voided_at, voided_by, void_reason) on public.price_history to authenticated;
grant update (voided_at, voided_by, void_reason) on public.price_versions to authenticated;
grant update (voided_at, voided_by, void_reason) on public.spend_entries to authenticated;
revoke execute on function public.trg_void_guard(), public.trg_audit_void() from public, anon, authenticated;
