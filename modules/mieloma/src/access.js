// Control de acceso a condiciones comerciales (precios diferenciados y acuerdos de gasto).
// Roles de la base compartida: lector (solo ver catálogo), editor, revisor, admin. Las condiciones comerciales
// exigen editor o superior. Sin conexión (modo local) no hay autenticación: los datos viven solo en este navegador.
export const COMMERCIAL_ROLES = ["editor", "revisor", "admin"];
export function commercialAccess(cs) {
  if (!cs) return { view: true, edit: true, why: "Sin base compartida" };
  if (cs.status === "local") return { view: true, edit: true, why: "Modo local: datos solo en este navegador" };
  if (cs.status === "ready" && COMMERCIAL_ROLES.includes(cs.role)) return { view: true, edit: true, why: `Rol ${cs.role}` };
  if (cs.status === "ready") return { view: false, edit: false, why: "Con tu rol (solo lectura) no se muestran condiciones comerciales." };
  return { view: false, edit: false, why: "Inicia sesión para ver condiciones comerciales." };
}
// Condición de precio «diferenciada» (distinta de la general) = dato comercial.
export const isCommercialCondition = (v) => (v.condition && v.condition !== "general") || !!v.center;
