-- Comparafar · migración 005 · archivar medicamentos/presentaciones y anular acuerdos
-- Requiere 001, 003 y 004. ADITIVA e idempotente: añade una columna, endurece guardas y amplía la auditoría; no borra ni cambia datos.
-- NO aplicar en producción sin revisión (ver LEEME.md).
-- Reglas (decididas con el equipo): archivar y anular solo por revisor o admin; el editor puede editar. Nada se borra.
--  · Archivar es REVERSIBLE (se puede restaurar).  · Anular un acuerdo es IRREVERSIBLE y exige motivo.

-- 1) ref_medicines.archived (ref_presentations ya la tiene) ---------------------------------------------------------------------
alter table public.ref_medicines add column if not exists archived boolean not null default false;

-- 2) Cambiar «archived» exige revisor o admin ---------------------------------------------------------------------------------
create or replace function public.trg_archive_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived is distinct from old.archived and (public.app_role() is null or public.app_role() not in ('revisor','admin')) then
    raise exception 'Solo revisor o administrador pueden archivar o restaurar.' using errcode = '42501';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['ref_medicines','ref_presentations'] loop
    execute format('drop trigger if exists archive_guard on public.%I', t);
    execute format('create trigger archive_guard before update on public.%I for each row execute function public.trg_archive_guard()', t);
  end loop;
end $$;

-- 3) Acuerdos: control de versión (003) + anulación irreversible, con motivo, solo revisor/admin ---------------------------------
-- La anulación vive en data: {"status":"anulado","voided":{"reason":"…","at":"…","by":"…"}}
create or replace function public.trg_agreements_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    if new.data ->> 'status' = 'anulado' then
      raise exception 'Un acuerdo nuevo no puede nacer anulado.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.version <> old.version + 1 then
    raise exception 'Conflicto de versión: el acuerdo % lo ha modificado otra persona (versión actual %).', old.id, old.version using errcode = '40001';
  end if;
  if old.data ->> 'status' = 'anulado' then
    raise exception 'Un acuerdo anulado no se modifica.' using errcode = '42501';
  end if;
  if new.data ->> 'status' = 'anulado' then
    if public.app_role() is null or public.app_role() not in ('revisor','admin') then
      raise exception 'Solo revisor o administrador pueden anular un acuerdo.' using errcode = '42501';
    end if;
    if new.data -> 'voided' ->> 'reason' is null or length(trim(new.data -> 'voided' ->> 'reason')) = 0 then
      raise exception 'El motivo de anulación es obligatorio.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- 4) Auditoría: se registra el estado de archivo / anulación ----------------------------------------------------------------------
create or replace function public.trg_audit_eco() returns trigger
language plpgsql security definer set search_path = public as $$
declare ent text := tg_table_name; det jsonb;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) ->> 'voided_at') is distinct from (to_jsonb(old) ->> 'voided_at') then return new; end if;
  if ent = 'price_versions' then det := jsonb_build_object('presentation', new.presentation_id, 'price_units', new.price_units, 'valid_from', new.valid_from, 'valid_to', new.valid_to, 'condition', new.condition, 'center', new.center, 'source', new.source);
  elsif ent = 'agreements' then
    det := jsonb_build_object('title', new.title, 'version', new.version, 'type', new.type, 'status', coalesce(new.data ->> 'status', 'vigente'), 'reason', new.data -> 'voided' ->> 'reason');
    insert into public.agreement_versions (agreement_id, version, data, changed_by) values (new.id, new.version, new.data, auth.uid());
  elsif ent = 'spend_entries' then det := jsonb_build_object('kind', new.kind, 'amount_cents', new.amount_cents, 'as_of', new.as_of, 'source', new.source);
  else det := jsonb_build_object('name', coalesce(to_jsonb(new) ->> 'name', to_jsonb(new) ->> 'label'), 'archived', to_jsonb(new) ->> 'archived');
  end if;
  insert into public.audit_log (user_id, user_email, action, entity, entity_id, detail)
  values (auth.uid(), auth.jwt() ->> 'email', lower(tg_op), ent, new.id, det);
  return new;
end $$;

revoke execute on function public.trg_archive_guard() from public, anon, authenticated;
