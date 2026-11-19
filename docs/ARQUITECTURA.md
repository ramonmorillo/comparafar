# Arquitectura (borrador)

## Fases
1. Repo y publicación web con el módulo de mieloma tal cual.
2. Backend compartido (Supabase, plan gratuito, región UE) **solo para datos de referencia**: esquemas, precios, historial de precios, verificaciones y auditoría. Login y roles (lector, editor, revisor, administrador). Historial que no se sobrescribe y control de versión por registro.
3. Carcasa multimódulo y segundo módulo.
4. Datos de paciente, solo con aprobación de protección de datos.

## Riesgos conocidos del plan gratuito de Supabase (comprobado el 19/11/2026 en su documentación)
- Los proyectos se pausan tras 7 días de inactividad.
- Sin copias de seguridad diarias: hace falta exportación periódica propia.
- Límite de 2 proyectos activos y 500 MB de base de datos.

## Pendiente de decidir
- Alojamiento web (GitHub Pages exige repo público en plan gratuito, a confirmar; Cloudflare Pages admite repo privado).
- Propiedad del repo y de la cuenta de Supabase (organización con varios administradores).
