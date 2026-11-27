// Test genérico: para CADA pack en packs/, cada solución debe llegar a su final.
// Una aventura nueva no necesita tests propios para esto: basta con su soluciones.json.
import { describe, expect, it } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadPackDir } from "../src/cli/fsPack.js";
import { playSolutions } from "../src/session/solutions.js";
import { lintPack } from "../src/engine/lint.js";

const dirs = readdirSync("packs").map((d) => join("packs", d)).filter((d) => existsSync(join(d, "pack.json")));

for (const dir of dirs) {
  describe(`pack ${dir}`, () => {
    const pack = loadPackDir(dir);
    it("pasa el lint de diseño sin avisos", () => expect(lintPack(pack)).toEqual([]));
    it("tiene una solución para cada final que no sea de derrota", () => {
      const need = pack.quest.finales.filter((f) => f.tipo !== "derrota").map((f) => f.id);
      const have = new Set(pack.data.soluciones.map((s) => s.final));
      expect(need.filter((f) => !have.has(f))).toEqual([]);
    });
    it("cada solución llega a su final", async () => {
      const results = await playSolutions(pack);
      for (const r of results) expect(r.ok, `${r.final}: acabó en ${r.obtenido ?? "nada"}\n${r.detalle}`).toBe(true);
    });
  });
}
