// Pack empaquetado en el bundle (en el navegador no hay sistema de ficheros).
import meta from "../packs/la-garganta/pack.json";
import quest from "../packs/la-garganta/quest.json";
import items from "../packs/la-garganta/items.json";
import recipes from "../packs/la-garganta/recipes.json";
import locations from "../packs/la-garganta/locations.json";
import npcs from "../packs/la-garganta/npcs.json";
import enemies from "../packs/la-garganta/enemies.json";
import { loadPack } from "../src/engine/pack.js";

export const pack = loadPack({ ...meta, quest, items, recipes, locations, npcs, enemies });
