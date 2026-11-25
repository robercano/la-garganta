// Genera dist/index.html: un único fichero autocontenido (HTML + CSS + JS + pack).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const r = await build({ entryPoints: ["web/main.ts"], bundle: true, format: "iife", target: "es2020", minify: true, write: false });
const js = r.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = readFileSync("web/index.html", "utf8").replace("/*__BUNDLE__*/", () => js);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
