import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, checkEmail, loginErrorMessage, parseAuthHash, checkNewPassword, MSG_EMAIL_INCOMPLETO, MSG_INVALID_LOGIN } from "../src/cloudAuth.js";

test("normalizeEmail recorta y pasa a minúsculas", () => {
  assert.equal(normalizeEmail("  Ramon.Morillo@Ejemplo.ES \n"), "ramon.morillo@ejemplo.es");
  assert.equal(normalizeEmail(null), "");
});

test("checkEmail acepta correos completos y devuelve el normalizado", () => {
  const r = checkEmail("  Ana@Hospital.Sas.es ");
  assert.deepEqual(r, { ok: true, email: "ana@hospital.sas.es", reason: null, msg: null });
});

test("checkEmail rechaza sin @, sin punto en el dominio y otras formas incompletas, con el mensaje pedido", () => {
  for (const s of ["ana", "ana.hospital.es", "ana@hospitales", "ana@hospital.", "ana@.es", "ana@hos..es", "@hospital.es", "a b@hospital.es", "a@b@hospital.es", "ana@hospital,es"]) {
    const r = checkEmail(s);
    assert.equal(r.ok, false, s);
    assert.equal(r.msg, MSG_EMAIL_INCOMPLETO, s);
  }
  assert.equal(MSG_EMAIL_INCOMPLETO, "El correo parece incompleto: revisa que tenga el punto antes de 'es' o 'com'.");
});

test("checkEmail distingue el correo vacío", () => {
  assert.equal(checkEmail("   ").reason, "vacio");
});

test("el punto solo cuenta en el dominio, no en la parte local", () => {
  assert.equal(checkEmail("ana.perez@hospitales").ok, false);
  assert.equal(checkEmail("ana.perez@hospital.es").ok, true);
});

test("loginErrorMessage: Invalid login con texto nuevo; el resto sigue diferenciado", () => {
  assert.equal(loginErrorMessage(new Error("Invalid login credentials")), MSG_INVALID_LOGIN);
  assert.match(MSG_INVALID_LOGIN, /Comprueba que el correo está completo.*administrador que la restablezca/);
  assert.equal(loginErrorMessage(new Error("Email not confirmed")), "No se pudo iniciar sesión: Email not confirmed");
  assert.equal(loginErrorMessage(new Error("Failed to fetch")), "No se pudo iniciar sesión: Failed to fetch");
});

test("parseAuthHash detecta enlace caducado y recuperación", () => {
  const exp = parseAuthHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(exp.expired, true); assert.equal(exp.recovery, false);
  assert.equal(parseAuthHash("#error=access_denied&error_code=other").expired, false);
  const rec = parseAuthHash("#access_token=abc&refresh_token=d&type=recovery");
  assert.equal(rec.recovery, true); assert.equal(rec.expired, false);
  for (const h of ["", "#", "#plataforma", "#costes", undefined]) assert.deepEqual(parseAuthHash(h), { error: null, expired: false, recovery: false });
});

test("checkNewPassword: mínimo 8 y coincidencia", () => {
  assert.match(checkNewPassword("abc1234", "abc1234"), /al menos 8/);
  assert.match(checkNewPassword("abcd1234", "abcd12345"), /no coinciden/);
  assert.equal(checkNewPassword("abcd1234", "abcd1234"), null);
});
