// Control de acceso a condiciones comerciales (precios diferenciados y acuerdos de gasto).
// Roles de la base compartida: lector (solo ver catálogo), editor, revisor, admin. Las condiciones comerciales
// exigen editor o superior. Sin conexión (modo local) no hay autenticación: los datos viven solo en este navegador.
export const COMMERCIAL_ROLES = ["editor", "revisor", "admin"];
// `void`: puede anular precios y gasto registrado (solo revisor y admin; sin conexión no hay roles).
export const VOID_ROLES = ["revisor", "admin"];
export function commercialAccess(cs) {
  if (!cs) return { view: true, edit: true, void: true, why: "Sin base compartida" };
  if (cs.status === "local") return { view: true, edit: true, void: true, why: "Modo local: datos solo en este navegador" };
  // Con la sincronización económica apagada (cs.ecoSync === false) la nube no recibe anulaciones: se bloquean para que
  // nadie crea que quedan registradas para el resto del equipo (un precio anulado volvería a contar al recargar).
  if (cs.status === "ready" && COMMERCIAL_ROLES.includes(cs.role)) return { view: true, edit: true, void: VOID_ROLES.includes(cs.role) && cs.ecoSync !== false, why: `Rol ${cs.role}` + (cs.ecoSync === false && VOID_ROLES.includes(cs.role) ? " · anular no disponible hasta activar la sincronización económica" : "") };
  if (cs.status === "ready") return { view: false, edit: false, void: false, why: "Con tu rol (solo lectura) no se muestran condiciones comerciales." };
  return { view: false, edit: false, void: false, why: "Inicia sesión para ver condiciones comerciales." };
}
// Condición de precio «diferenciada» (distinta de la general) = dato comercial.
export const isCommercialCondition = (v) => (v.condition && v.condition !== "general") || !!v.center;
