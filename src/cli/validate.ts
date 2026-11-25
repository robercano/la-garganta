// npm run validate [carpeta]: valida un pack y sale con error si algo falla.
import { loadPackDir } from "./fsPack.js";
import { PackError } from "../engine/pack.js";

const dir = process.argv[2] ?? "packs/la-garganta";
try {
  const p = loadPackDir(dir);
  const d = p.data;
  console.log(`OK ${d.id} v${d.version}: ${d.locations.length} salas, ${d.items.length} objetos, ${d.recipes.length} recetas, ${d.npcs.length} NPC, ${d.enemies.length} enemigos, ${d.quest.finales.length} finales.`);
} catch (e) {
  console.error(e instanceof PackError ? e.message : e);
  process.exit(1);
}
