-- Comparafar · 006: tiempo real para las tablas de los módulos económicos (requiere 003).
-- El cliente (cloud.js > subscribe) escucha estas tablas cuando CLOUD.eco = true, pero 003 no las añadió a la publicación
-- supabase_realtime, así que la base no emitía sus cambios. Aditiva e idempotente; no cambia datos, permisos ni RLS
-- (Realtime respeta las políticas RLS: un lector sigue sin recibir condiciones comerciales).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then   -- en pglite (pruebas) no existe
    foreach t in array array['ref_medicines','ref_presentations','price_versions','agreements','spend_entries'] loop
      if to_regclass('public.' || t) is not null
         and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
