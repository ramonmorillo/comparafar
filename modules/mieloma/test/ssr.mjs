import { build } from "esbuild"; import path from "path"; import { createRequire } from "module";
const root = path.resolve(import.meta.dirname, "..");
await build({ entryPoints: [root + "/src/main.jsx"], bundle: true, outfile: root + "/build/ssr-bundle.cjs", format: "cjs", platform: "node", jsx: "transform", loader: { ".json": "json" }, external: ["react", "react-dom"], logLevel: "error" });
const require = createRequire(root + "/package.json");
const store = {};
globalThis.window = { location: { hash: "" }, addEventListener() {}, removeEventListener() {}, localStorage: { getItem: (k) => store[k] || null, setItem() {}, removeItem() {} }, scrollTo() {} };
const { App, ROUTES } = require(root + "/build/ssr-bundle.cjs");
const React = require("react"); const { renderToString } = require("react-dom/server");
let bad = 0;
for (const [id] of ROUTES) {
  window.location.hash = "#" + id;
  try { const h = renderToString(React.createElement(App)); const nan = (h.match(/NaN|undefined|\[object/g) || []).length; console.log(id.padEnd(12), h.length, nan ? "SOSPECHOSO x" + nan : "ok"); if (nan) { bad++; const i = h.search(/NaN|undefined|\[object/); console.log("   ...", h.slice(Math.max(0, i - 150), i + 60).replace(/<[^>]+>/g, "|")); } }
  catch (e) { bad++; console.log(id.padEnd(12), "ERROR", e.stack.split("\n").slice(0, 4).join(" / ")); }
}
process.exit(bad ? 1 : 0);
