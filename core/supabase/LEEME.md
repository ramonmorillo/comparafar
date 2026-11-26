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

## Módulos económicos (003) — NO aplicado
`003_modulos_economicos.sql` es aditiva e idempotente (catálogo de referencia, versiones de precio, acuerdos de gasto, gasto registrado, auditoría y RLS). No la ejecutes en el proyecto en producción: pruébala primero en una rama o proyecto de pruebas y ejecuta antes `node core/supabase/test-rls-eco.mjs` (requiere `npm i --no-save @electric-sql/pglite` en `modules/mieloma`). Las condiciones comerciales solo las ven editor, revisor y admin. El cliente existe pero está apagado (`eco: false` en `modules/mieloma/src/cloudConfig.js`); actívalo solo después de aplicar 003.

## Anulaciones (004) — NO aplicado
`004_anulaciones.sql` (requiere 001 y 003): permite anular (no borrar) versiones de precio, gasto registrado y su reflejo en `price_history`, solo por revisor/admin y con motivo obligatorio. Aditiva e idempotente. Ejecútala después de 003 y antes de usar «Anular» con la base compartida. Verifica con `node core/supabase/test-rls-eco.mjs` (pglite).

## Archivar y anular acuerdos (005) — NO aplicado
`005_catalogo_acuerdos.sql` (requiere 001, 003 y 004): columna `ref_medicines.archived`, archivar/restaurar solo revisor/admin, y anulación de acuerdos irreversible, con motivo y solo revisor/admin. Aditiva e idempotente. Orden: 003 → 004 → 005. Verifica con `node core/supabase/test-rls-eco.mjs` (pglite).

