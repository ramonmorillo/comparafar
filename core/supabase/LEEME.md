# Puesta en marcha de la base compartida (una sola vez)

1. **Authentication → Providers → Email**: desactiva *Allow new users to sign up* (solo por invitación).
2. **Authentication → Users → Add user → Create new user**: tu correo + contraseña, marca *Auto Confirm User*.
3. **SQL Editor**: pega y ejecuta `001_schema.sql`, después `002_seed_catalog.sql`.
4. En el SQL Editor, hazte administrador (cambia el correo):
   `update public.profiles set role='admin' where email='TU_CORREO';`
5. Para cada compañero: repite el paso 2; después, como admin, asigna rol
   (`lector` por defecto, `editor`, `revisor`, `admin`) con un `update public.profiles set role='editor' where email='...';`
6. Abre la web publicada (GitHub Pages) e inicia sesión. En el artefacto de Claude la nube no funciona (el sandbox bloquea la red).

Roles: lector (ver) · editor (precios, presentaciones, esquemas) · revisor (además verifica) · admin (además gestiona usuarios y ve auditoría).
Los datos de pacientes NO se envían a Supabase.
`test-rls.mjs` verifica las políticas con pglite (stub de auth); no sustituye una prueba real en tu proyecto.

## Acceso: contraseñas, enlaces de recuperación y correo

**(a) Restablecer la contraseña de un usuario por SQL** (SQL Editor, como propietario del proyecto; sustituye los marcadores, no pegues contraseñas reales en chats, commits ni tickets):

```sql
update auth.users
   set encrypted_password = extensions.crypt('<NUEVA>', extensions.gen_salt('bf', 10))
 where email = '<CORREO>';
```

Comprueba que afecta a una sola fila y comunica la contraseña temporal por un canal distinto del correo; el usuario puede cambiarla después con «¿Olvidaste tu contraseña?». Si `extensions.crypt` no existe, la extensión `pgcrypto` no está habilitada en el esquema `extensions` (Database → Extensions).

**(b) URL del sitio y redirecciones** (Authentication → URL Configuration):
- *Site URL*: `https://ramonmorillo.es/comparafar/`
- *Redirect URLs*: añade `https://ramonmorillo.es/comparafar/` (la que usa `resetPasswordForEmail` en `modules/mieloma/src/cloud.js`). Si la URL no está en la lista, Supabase redirige a la Site URL y el enlace puede no abrir la pantalla «Elige una nueva contraseña».
- Los enlaces caducan y son de un solo uso (los escáneres de correo corporativos pueden «gastarlos» al previsualizarlos): la app muestra «El enlace ha caducado o ya se usó; pide otro».

**(c) Aviso sobre el SMTP por defecto**: el servicio de correo integrado de Supabase solo envía a direcciones de miembros del equipo de la organización (y con límite de envíos por hora). Para que la recuperación funcione con el resto de usuarios hay que configurar un SMTP propio (Authentication → SMTP Settings). Mientras tanto, usa el restablecimiento por SQL de (a).

## Estado de las migraciones en producción (comprobado el 26/11/2026 desde el SQL Editor)
- **001 y 002:** aplicadas.
- **003:** aplicada (tablas `ref_*`, `price_versions`, `agreements`, `agreement_versions`, `spend_entries`; vacías hasta activar `eco`).
- **004:** aplicada y verificada (`voided_at` en `price_history`, `price_versions`, `spend_entries`).
- **005:** aplicada y verificada (`ref_medicines.archived`).
- **006:** aplicada y verificada (Realtime en 8 tablas: las 3 de 001 y las 5 económicas).
- **Cliente:** `eco: true` (sincronización económica activa).
Comprobaciones: 004 → `select table_name from information_schema.columns where table_schema='public' and column_name='voided_at';` (3 filas); 005 → `select column_name from information_schema.columns where table_schema='public' and table_name='ref_medicines' and column_name='archived';` (1 fila); 006 → `select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public';` (8 filas). Las migraciones se pegan a mano en el SQL Editor, por lo que `supabase_migrations.schema_migrations` no existe.

## Módulos económicos (003) — aplicada
`003_modulos_economicos.sql` es aditiva e idempotente (catálogo de referencia, versiones de precio, acuerdos de gasto, gasto registrado, auditoría y RLS). Las condiciones comerciales solo las ven editor, revisor y admin. El cliente está activo desde el 26/11/2026 (`eco: true` en `modules/mieloma/src/cloudConfig.js`), tras aplicar 004–006.

## Anulaciones (004) — aplicada
`004_anulaciones.sql` (requiere 001 y 003): permite anular (no borrar) versiones de precio, gasto registrado y su reflejo en `price_history`, solo por revisor/admin y con motivo obligatorio. Aditiva e idempotente. Verifica con `node core/supabase/test-rls-eco.mjs` (pglite).

## Archivar y anular acuerdos (005) — aplicada
`005_catalogo_acuerdos.sql` (requiere 001, 003 y 004): columna `ref_medicines.archived`, archivar/restaurar solo revisor/admin, y anulación de acuerdos irreversible, con motivo y solo revisor/admin. Aditiva e idempotente. Orden: 004 → 005 → 006.

## Tiempo real de los módulos económicos (006) — aplicada
`006_realtime_economicos.sql` (requiere 003): añade `ref_medicines`, `ref_presentations`, `price_versions`, `agreements` y `spend_entries` a la publicación `supabase_realtime`. Sin ella, con `eco: true` los cambios de otras personas llegan solo por el sondeo (90 s), al volver a la pestaña o al reconectar. Idempotente; no cambia datos ni permisos.

## Antes de aplicar en producción (plan gratuito: sin copias de seguridad ni proyecto de pruebas)
1. Exporta los datos: en la app, Administración → exportar copia JSON; y en Supabase, Table Editor → exportar CSV de `catalog_items`, `price_history` y `schemes`.
2. Aplica **una migración cada vez**, en orden 004 → 005 → 006, y tras cada una ejecuta su comprobación y entra en la web con un usuario editor.
3. Pon `eco: true` solo al final y haz la prueba de dos sesiones.
