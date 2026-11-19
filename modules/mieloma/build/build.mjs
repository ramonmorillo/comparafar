import { build } from "esbuild"; import fs from "fs"; import path from "path";
const root = path.resolve(import.meta.dirname, "..");
const r = await build({ entryPoints: [root + "/src/main.jsx"], bundle: true, write: false, format: "iife", minify: true, jsx: "transform", loader: { ".json": "json" }, target: "es2019",
  alias: { react: root + "/src/react-shim.js", "react-dom/client": root + "/src/reactdom-shim.js" }, define: { "process.env.NODE_ENV": '"production"' } });
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(root + "/build/style.css", "utf8");
let html = fs.readFileSync(root + "/build/template.html", "utf8");
html = html.replace("/*CSS*/", () => css).replace("/*JS*/", () => js);
fs.writeFileSync(root + "/build/index.html", html);
console.log("ok", (html.length / 1024).toFixed(0) + " KB");
