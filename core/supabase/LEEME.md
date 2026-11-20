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

## Módulos económicos (003) — NO aplicado
`003_modulos_economicos.sql` es aditiva e idempotente (catálogo de referencia, versiones de precio, acuerdos de gasto, gasto registrado, auditoría y RLS). No la ejecutes en el proyecto en producción: pruébala primero en una rama o proyecto de pruebas y ejecuta antes `node core/supabase/test-rls-eco.mjs` (requiere `npm i --no-save @electric-sql/pglite` en `modules/mieloma`). Las condiciones comerciales solo las ven editor, revisor y admin. El cliente existe pero está apagado (`eco: false` en `modules/mieloma/src/cloudConfig.js`); actívalo solo después de aplicar 003.
