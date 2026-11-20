# Módulos económicos: Importar desde Oncofar · Catálogo · Costes · Acuerdos de gasto

Estado: implementado y probado con documentos **sintéticos**. Pendiente de validar con una exportación real anonimizada de Oncofar (ver «Limitaciones»).

## Dónde está cada cosa (`modules/mieloma/src/`)
| Apartado | Lógica pura (con pruebas) | Pantalla |
|---|---|---|
| Importar desde Oncofar | `pdftext.js` (pdf.js, texto + posiciones, hash), `oncofar.js` (reconstrucción de la hoja), `importflow.js` (borrador → revisión → confirmación atómica, reimportación, revisiones) | `pages_d.jsx` · `#importar` |
| Catálogo de medicamentos | `refcatalog.js` (principio activo → medicamento → presentación, alias, deduplicación), `cima.js` (API CIMA) | `pages_d.jsx` · `#catalogo` |
| Costes | `money.js` (enteros), `pricing.js` (versiones de precio), `estimate.js` (estimación de planes) | `pages_e.jsx` · `#costes` |
| Acuerdos de gasto | `agreements.js` (registro, alcance, evaluación), `access.js` (permisos), `exportsEco.js` (exportaciones) | `pages_e.jsx` · `#acuerdos` |

## Estado de la aplicación y compatibilidad
Claves **nuevas y aditivas** (valores por defecto vacíos; `v` sigue en 1): `ref`, `priceVersions`, `agreements`, `spendEntries`, `importDrafts`, `importedPlans`, `estimates`.
Un estado guardado antes de estos cambios se abre igual: `load()` ya completa con los valores por defecto. `catalog[].history` **no se modifica ni se migra**: se lee como versiones de precio derivadas (cada entrada vale hasta el día anterior a la siguiente). La prueba `test/legacy.test.mjs` compara las exportaciones de un registro anterior, byte a byte, con las generadas por el código del commit `fb8382d`.

## Reglas de cálculo
- **Dinero**: enteros en unidades de 0,0001 €. Redondeo *mitad hacia arriba (simétrico)* a 0,01 € **una vez por administración**; los totales suman céntimos ya redondeados.
- **Precios**: cada cambio crea una versión (precio, moneda EUR, unidad de compra, contenido por unidad, IVA, fuente, inicio y fin). No se admiten vigencias solapadas por presentación+centro+condición; para sustituir una vigencia abierta hay que cerrarla explícitamente. Un precio general nuevo se refleja también (solo se añade) en `catalog[].history`, para que la Calculadora y el motor heredado vean el mismo precio. Las condiciones diferenciadas (centro/condición) no se reflejan.
- **Coste por mg** solo con equivalencia mg/envase explícita **y comprobada**.
- **Estimación**: por administración, ciclo, fase, plan y periodo. Selecciona la combinación de envases completos más barata (`minCover` del motor). Aprovechamiento del sobrante solo si se configura explícitamente. Una línea sin correspondencia, presentación, equivalencia, precio vigente o datos de paciente se marca **incompleta** con su motivo y no suma; el total se rotula «parcial». Cada estimación guardada es inmutable y conserva precios, versión, fuente y regla; recalcular crea otra.
- **Acuerdos**: el gasto *realizado* viene del acumulado contable fechado más reciente (más la ejecución registrada después) o, si no hay, de la ejecución de la agenda; si no hay ninguna fuente se muestra «pendiente», nunca 0 €. El *proyectado* es la estimación por calendario después de la fecha de corte. Los ajustes (descuento, devolución, tramos) solo se calculan con fórmula configurada; si coinciden varios acuerdos sin orden y base definidos, queda «ajuste pendiente» con la incidencia.

## CIMA (comprobado el 20/11/2026 contra el servicio real)
- `GET medicamentos` (`nombre`, `practiv1`, `cn`, `nregistro`…): 200 `{totalFilas,pagina,tamanioPagina:200,resultados}`; `pagina` empieza en 1. Sin resultados: 200 con lista vacía; **204 sin cuerpo** en `medicamento?cn=` inexistente.
- `nombre` solo encuentra marcas (`nombre=glofitamab` → 0; `practiv1=glofitamab` → Columvi): la búsqueda prueba ambos.
- `nregistro` puede ser alfanumérico (`1161101004IP`); el CN (6–7 dígitos, puede empezar por 0) se guarda como texto.
- En soluciones, `principiosActivos.cantidad/unidad` es la **concentración** («2,50 mg» para 2,5 mg/ml), no los mg por vial: nunca se usa como mg/envase. La equivalencia se **propone** (sin comprobar) solo en tres patrones: «X mg», «X g/V ml» y «C mg/ml × volumen del envase» tomado del nombre de la presentación.
- CORS abierto en GET. Solo se envían términos escritos por el usuario en el Catálogo; los fixtures de `test/fixtures/` son respuestas reales de CIMA.

## Privacidad
El PDF se procesa en el navegador. No se guarda el fichero ni su nombre; solo su hash SHA-256 (para detectar reimportaciones) y los campos estructurados. Las observaciones libres del documento no se persisten (solo indicadores derivados). Los planes importados y las estimaciones **no** van a Supabase (pueden llevar código de paciente seudonimizado).

## Permisos
`access.js`: precios diferenciados, acuerdos y gasto registrado requieren rol editor, revisor o admin (o modo sin conexión). Un lector no los ve ni salen en sus exportaciones (aparece una nota). Se registra el usuario (correo) en precios, acuerdos, acumulados y ajustes cuando hay sesión.

## Migración SQL (no aplicada)
`core/supabase/003_modulos_economicos.sql`: aditiva e idempotente; tablas de catálogo de referencia, `price_versions` (solo inserción + cierre de vigencia, sin solapes), `agreements` (+ histórico y control de versión), `spend_entries`, auditoría y RLS. Probada con `core/supabase/test-rls-eco.mjs` (pglite). **Falta** el cliente de sincronización de estas tablas: hoy los datos nuevos viven en el navegador (y en la copia de seguridad JSON de la app).

## Pruebas
```
cd modules/mieloma
npm ci
npm test            # 66 pruebas de lógica + render de todas las rutas (sin red)
npm run test:e2e    # Chromium real, app compilada, PDFs sintéticos (requiere Playwright)
npm i --no-save @electric-sql/pglite && npm run test:rls
```
No hay configuración de lint ni de tipos en el repositorio; no se ha añadido.

## Limitaciones y validaciones pendientes
1. **Formato real de Oncofar sin validar.** El parser se diseñó a partir de una *fotografía* de una hoja impresa (no un PDF): columnas Orden · Tipo Terapia · Días · Vía · T.Admin/Posología · Componentes · Dosis, filas multilínea. La geometría del texto de un PDF real, los saltos de página, los encabezados repetidos y cómo se expresan las **fases** (inducción/mantenimiento) son hipótesis ejercitadas con documentos sintéticos. Para cerrarlo hacen falta exportaciones anonimizadas de: (a) un esquema de varias páginas; (b) uno con dos o más fases; (c) uno con fármacos en días distintos (p. ej. días 1, 8, 15); (d) uno con dosis en mg/kg, rangos o intervalos en «Dosis Base/Intervalo»; (e) uno sin «Nº Máximo de Ciclos»; (f) uno escaneado/imagen real; (g) una hoja con fila «Otros» y otra «Premedicación» para confirmar la clasificación.
2. La hoja de ejemplo describe un ciclo concreto (`Ciclo 2: día 1`, `Nº Máximo de Ciclos 1`): se trata como tramo documentado y se pide confirmar.
3. Las filas de soporte/premedicación se clasifican solo si la columna «Tipo Terapia» lo dice expresamente (Antineoplásico, Pauta antiemética, Hidratación). «Otros» queda por decidir.
4. Sincronización en la nube de los datos nuevos: pendiente (ver arriba).
5. El gasto realizado de planes importados no tiene registro de ejecución propio: solo cuenta como proyectado hasta que se registre un acumulado contable.
6. El alcance por centro, indicación o población de un acuerdo se registra y se avisa, pero no puede aplicarse al gasto porque los datos de gasto no llevan esa dimensión.
7. Las fechas de los selectores siguen el idioma del navegador.
