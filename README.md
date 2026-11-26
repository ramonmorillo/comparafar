# Comparafar

Plataforma de apoyo para Farmacia Hospitalaria, organizada en módulos. Primer módulo: **mieloma múltiple** (antes «MieloFarma»). La interfaz tiene una pantalla general («Todos los módulos») y un menú propio por módulo.

> Estado: prototipo. Los datos de pacientes son ficticios; las pautas y los precios proceden del Excel «Mielola multiple costes 2026» y están **pendientes de validación**. Las comparaciones son económicas y no implican superioridad terapéutica ni recomendación clínica.

## Módulos económicos
Importar desde Oncofar, catálogo de medicamentos (con CIMA), costes y acuerdos de gasto: ver `docs/MODULOS-ECONOMICOS.md`.

## Estado de la base compartida (Supabase)
Catálogo de costes, esquemas y módulos económicos (versiones de precio, acuerdos, gasto, catálogo de medicamentos) se comparten entre usuarios y equipos (migraciones 001–006 aplicadas, `eco: true`). Los datos de pacientes, planes importados y estimaciones **no** se sincronizan. Copia de seguridad semanal cifrada: `core/backup/BACKUP.md`. Detalle de migraciones en `core/supabase/LEEME.md`.

## Estructura
- `modules/mieloma/`: motor de cálculo, datos importados del Excel, auditoría e interfaz (React). Ver su `LEEME.txt`.
- `core/`: (pendiente) autenticación, roles, auditoría de cambios y catálogo común.
- `docs/`: arquitectura, decisiones y validación clínica por módulo.

## Reglas del proyecto
- Nunca subir al repo claves secretas (`service_role`, contraseñas) ni datos de pacientes.
- Solo la clave pública (publishable) de Supabase puede ir en el código de la web, protegida con reglas de acceso por fila (RLS).
- Pacientes: solo códigos pseudonimizados, y no se guardan en la nube sin la aprobación de protección de datos del centro.
- Cada módulo declara su versión de motor y de datos en cada informe.

## Desarrollo (módulo mieloma)
```
cd modules/mieloma
npm install
node --test test/engine.test.mjs
node build/build.mjs   # genera build/index.html (no se versiona)
```
