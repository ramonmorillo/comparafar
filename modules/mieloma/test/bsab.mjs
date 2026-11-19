import { computeScheme, buildBsAbScheme } from "../src/engine.js";
import { CATALOG_INITIAL, BSAB_PRESETS } from "../src/data.js";
const pt={weight:88,height:1.6,scOverride:1.83};
for (const [k,c] of Object.entries(BSAB_PRESETS)) {
  for (const pol of ["theor","full"]) {
    const r=computeScheme(buildBsAbScheme(c),CATALOG_INITIAL,pt,{});
    console.log(k,pol,r.totals[pol].toFixed(2),"admins",r.events.length,"dur",r.durationDays,"excel",JSON.stringify(c.excel));
  }
}
