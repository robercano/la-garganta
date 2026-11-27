// npm run validate [carpeta] [--strict]: valida un pack (errores) y pasa el lint de diseño (avisos).
// Con --strict, los avisos también hacen fallar (así lo ejecuta la CI).
import { loadPackDir } from "./fsPack.js";
import { PackError } from "../engine/pack.js";
import { lintPack } from "../engine/lint.js";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const dir = args.find((a) => !a.startsWith("--")) ?? "packs/la-garganta";
try {
  const p = loadPackDir(dir);
  const d = p.data;
  console.log(`OK ${d.id} v${d.version}: ${d.locations.length} salas, ${d.items.length} objetos, ${d.recipes.length} recetas, ${d.npcs.length} NPC, ${d.enemies.length} enemigos, ${d.quest.finales.length} finales.`);
  const warnings = lintPack(p);
  for (const w of warnings) console.log(`  aviso [${w.regla}] ${w.donde}: ${w.mensaje}`);
  if (warnings.length) {
    console.log(`${warnings.length} aviso(s) de diseño. Ver docs/guia-de-diseno.md.`);
    if (strict) process.exit(1);
  }
} catch (e) {
  console.error(e instanceof PackError ? e.message : e);
  process.exit(1);
}
