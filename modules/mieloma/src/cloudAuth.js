// Utilidades puras de acceso (sin red ni Supabase): normalización y validación del correo,
// mensajes de error de inicio de sesión y lectura del hash de retorno de los enlaces de Auth.

export const MSG_EMAIL_INCOMPLETO = "El correo parece incompleto: revisa que tenga el punto antes de 'es' o 'com'.";
export const MSG_EMAIL_VACIO = "Introduce el correo.";
export const MSG_INVALID_LOGIN = "Correo o contraseña incorrectos. Comprueba que el correo está completo. Si no recuerdas la contraseña, pide a un administrador que la restablezca.";
export const MSG_LINK_CADUCADO = "El enlace ha caducado o ya se usó; pide otro";
export const MSG_RESET_NEUTRO = "Si el correo corresponde a una cuenta, recibirás un enlace para elegir una nueva contraseña. Revisa también la carpeta de correo no deseado.";
export const MIN_PW = 8;

export const normalizeEmail = (e) => String(e == null ? "" : e).trim().toLowerCase();

// Validación mínima (no sustituye al servidor): algo@dominio.tld sin espacios.
// Requiere "@", parte local no vacía y dominio con al menos un punto entre etiquetas no vacías.
export function checkEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, email, reason: "vacio", msg: MSG_EMAIL_VACIO };
  const bad = { ok: false, email, reason: "incompleto", msg: MSG_EMAIL_INCOMPLETO };
  const at = email.lastIndexOf("@");
  if (at < 1 || /\s/.test(email) || email.indexOf("@") !== at) return bad;
  const domain = email.slice(at + 1);
  if (!domain.includes(".") || domain.split(".").some((p) => !p)) return bad;
  return { ok: true, email, reason: null, msg: null };
}

export const isInvalidLogin = (e) => /Invalid login/i.test((e && e.message) || "");
// Solo "Invalid login" cambia de texto; el resto de errores se siguen mostrando con su detalle.
export const loginErrorMessage = (e) => isInvalidLogin(e) ? MSG_INVALID_LOGIN : "No se pudo iniciar sesión: " + ((e && e.message) || e);

// Hash de retorno de Supabase Auth: "#error=access_denied&error_code=otp_expired&..." o "#access_token=...&type=recovery".
export function parseAuthHash(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (!h || !h.includes("=")) return { error: null, expired: false, recovery: false };
  let p; try { p = new URLSearchParams(h); } catch (_) { return { error: null, expired: false, recovery: false }; }
  const error = p.get("error") || p.get("error_code") || null;
  const expired = !!error && /otp_expired/i.test(h);
  return { error, expired, recovery: !error && p.get("type") === "recovery" && !!p.get("access_token") };
}

export function checkNewPassword(a, b) {
  if (typeof a !== "string" || a.length < MIN_PW) return "La contraseña debe tener al menos " + MIN_PW + " caracteres.";
  if (a !== b) return "Las dos contraseñas no coinciden.";
  return null;
}
