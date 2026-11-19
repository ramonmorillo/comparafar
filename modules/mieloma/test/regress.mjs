import { computeScheme, ENGINE_VERSION } from "../src/engine.js";
import { CATALOG_INITIAL, SCHEMES_ALL } from "../src/data.js";
const pt = { weight: 88, height: 1.6, scMethod: "mosteller", scOverride: 1.83 };
const eur=(v)=>v.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
console.log("motor", ENGINE_VERSION);
for (const s of SCHEMES_ALL) {
  const r = computeScheme(s, CATALOG_INITIAL, pt, { policy: "mg", maint: "none", horizon: "all" });
  const main = r.totals.mainTheor;
  const ex = s.excel?.main?.value;
  let line = `${s.id.padEnd(16)} app ${eur(main).padStart(12)}  excel ${eur(ex).padStart(12)}  dif ${eur(main-ex).padStart(11)}`;
  for (const v of (s.maint||[])) {
    const rm = computeScheme(s, CATALOG_INITIAL, pt, { maint: v.id });
    const m = rm.totals.maintTheor; const e = s.excel?.maint?.[v.id]?.value;
    line += ` | M:${v.id} ${eur(m)} vs ${e!=null?eur(e):'-'} (${e!=null?eur(m-e):''})`;
  }
  console.log(line);
}
