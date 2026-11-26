# Copia de seguridad de la base compartida

**Por qué:** el plan gratuito de Supabase no hace copias diarias y pausa el proyecto tras 7 días sin actividad (`docs/ARQUITECTURA.md`).
**Qué hace:** `.github/workflows/backup.yml` se ejecuta cada domingo (y a demanda). `core/backup/backup.mjs` entra con una cuenta dedicada, vuelca por API REST las tablas de 001 y 003 a JSON, comprueba que los recuentos cuadran con la base y que la cuenta tiene rol revisor/admin (con otro rol saldrían tablas comerciales vacías **sin error**), y el workflow lo cifra y lo guarda 90 días como artefacto.
**Qué NO hace:** no hace restauración automática; no copia `profiles` (con rol revisor solo se ve la fila propia: apunta aparte los usuarios y roles) ni `auth.users`; la copia es lógica (datos), no un volcado completo de Postgres (no incluye funciones, triggers ni políticas: están en `core/supabase/*.sql`).

## Puesta en marcha (una vez)
1. **Cuenta dedicada:** Supabase → Authentication → Users → *Add user* (correo propio del servicio, contraseña larga y aleatoria, *Auto Confirm*). Después, en el SQL Editor: `update public.profiles set role='revisor' where email='CORREO_DE_COPIA';`
   Se usa `revisor` y no `admin` a propósito: si el secreto se filtrase, el daño posible es menor (no gestiona usuarios). Un revisor sí puede anular y verificar: trátalo como credencial sensible.
2. **Secretos del repositorio** (GitHub → Settings → Secrets and variables → Actions → *New repository secret*):
   - `BACKUP_EMAIL`: correo de la cuenta de copia.
   - `BACKUP_PASSWORD`: su contraseña.
   - `BACKUP_PASSPHRASE`: frase larga para cifrar. **Guárdala en un gestor de contraseñas fuera de GitHub: sin ella la copia no se puede abrir.**
3. **Primera ejecución:** pestaña Actions → «Copia de seguridad de la base compartida» → *Run workflow*. El resumen muestra las filas por tabla. Si aparece «COPIA FALLIDA», el mensaje indica la causa (login, rol, recuento…).

## Por qué va cifrada
Si el repositorio es público, los artefactos los puede descargar cualquier usuario de GitHub. Los acuerdos y precios comerciales no deben salir en claro. Los datos nunca se imprimen en el registro: solo recuentos.

## Descargar y abrir una copia
Actions → ejecución → Artifacts → `comparafar-backup-cifrado`. Descomprime el ZIP y:
```bash
export BACKUP_PASSPHRASE='la-frase'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in comparafar-backup-AAAAMMDD.tar.gz.enc | tar xz
```
Queda `backup/` con un `.json` por tabla y `manifest.json` (filas y SHA-256 de cada fichero). Verifica un fichero con `sha256sum backup/catalog_items.json` y compáralo con el manifiesto.

## Restaurar (manual; probar antes de necesitarla)
Cada `.json` es la lista de filas de la tabla tal cual están en la base. Orden por dependencias: `catalog_items` → `price_history` → `schemes` → `ref_ingredients` → `ref_medicines` → `ref_presentations` → `ref_aliases` → `price_versions` → `agreements` → `spend_entries`. Los historiales (`scheme_versions`, `agreement_versions`, `audit_log`) los generan los triggers: restaurarlos a mano exige desactivarlos temporalmente. No hay script de restauración: **haz un simulacro en un proyecto de pruebas antes de fiarte de esta copia** y anota aquí el procedimiento que funcione.
Una copia que nunca se ha restaurado es una hipótesis, no una garantía.

## Límites e incertidumbres
- Frecuencia semanal: se pueden perder hasta 7 días de cambios. Si hace falta menos, cambia el `cron`.
- Los artefactos caducan a los 90 días; para conservar una copia más tiempo, descárgala y guárdala en la unidad del Servicio.
- Si el repositorio es privado, los minutos de Actions del plan gratuito son limitados; esta tarea consume poco (segundos).
- El ping que ya hace `keepalive.yml` no está verificado como actividad. Esta copia hace peticiones autenticadas (login + lecturas), lo que probablemente sí cuenta, pero **no está comprobado**: vigila que el proyecto no aparezca pausado.
