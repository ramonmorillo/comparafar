// Aritmética monetaria en enteros (sin coma flotante en los importes guardados).
// Unidad interna: 1 unidad = 0,0001 € (UNITS_PER_EUR = 10 000). Un céntimo = 100 unidades.
// REGLA DE REDONDEO (documentada): mitad hacia arriba, simétrica respecto a cero ("half away from zero"),
// a 0,01 € y UNA SOLA VEZ por administración. Los totales de ciclo, esquema y periodo son la suma de céntimos
// ya redondeados; no se vuelve a redondear. Los precios unitarios admiten hasta 4 decimales.
export const UNITS_PER_EUR = 10000;
export const ROUNDING_RULE = "Mitad hacia arriba (simétrica respecto a cero) a 0,01 € una vez por administración; los totales suman céntimos ya redondeados.";

// Convierte euros (número o texto con coma o punto) a unidades enteras. Null si no es un importe válido.
export function eurosToUnits(v) {
  if (v == null || v === "") return null;
  let s = typeof v === "number" ? String(v) : String(v).trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (/e/i.test(s)) s = Number(s).toFixed(4);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s[0] === "-"; if (neg) s = s.slice(1);
  const [i, f = ""] = s.split(".");
  const frac = (f + "0000").slice(0, 4);
  let u = Number(i) * UNITS_PER_EUR + Number(frac);
  if (f.length > 4 && Number(f[4]) >= 5) u += 1; // half-up sobre el 5.º decimal
  return neg ? -u : u;
}
// División entera con redondeo half-away-from-zero (a/b con b > 0)
export function divRound(a, b) {
  if (!(b > 0)) throw new Error("División por cero o negativa");
  const q = Math.floor(Math.abs(a) / b), r = Math.abs(a) - q * b;
  const m = (2 * r >= b) ? q + 1 : q;
  return a < 0 ? -m : m;
}
export const unitsToCents = (u) => divRound(u, 100);
export const centsToEuros = (c) => c / 100;
export const unitsToEuros = (u) => u / UNITS_PER_EUR;
export const mulUnits = (units, qty) => Math.round(units * qty); // qty puede ser fraccionaria (aprovechamiento); resultado entero de unidades
export const sumInts = (arr) => arr.reduce((s, x) => s + x, 0);
export const fmtCents = (c) => (c == null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100));
export const fmtUnits = (u) => (u == null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(u / UNITS_PER_EUR));
