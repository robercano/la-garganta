import { describe, expect, it } from "vitest";
import { newGame, play, fight, pack, LIGHT, TO_HORNACINA } from "./helpers.js";
import { parse } from "../src/engine/parser.js";
import { scope, catalog, apply } from "../src/engine/engine.js";
import { applyNpcReply, npcContext } from "../src/engine/dialog.js";
import { initialState } from "../src/engine/state.js";
import { loadPack, PackError } from "../src/engine/pack.js";
import { readPackDir } from "../src/cli/fsPack.js";

describe("parser", () => {
  it("normaliza tildes, artículos y sinónimos", async () => {
    const g = await newGame();
    const sc = scope(g.state, pack);
    expect(parse("Coge la LÁMPARA", sc)).toEqual({ ok: true, cmd: { verbo: "coger", obj: { kind: "item", id: "lampara_vacia" } } });
    expect(parse("n", sc)).toEqual({ ok: true, cmd: { verbo: "ir", dir: "norte" } });
    expect(parse("ir hacia el este", sc)).toEqual({ ok: true, cmd: { verbo: "ir", dir: "este" } });
    expect(parse("combina lampara con bote de carburo", sc)).toMatchObject({ ok: true, cmd: { verbo: "combinar" } });
  });
  it("solo resuelve contra lo que está al alcance", async () => {
    const g = await newGame();
    expect(parse("coger rosario", scope(g.state, pack), catalog(pack))).toEqual({ ok: false, texto: "No ves eso por aquí." });
    expect(parse("coger espada legendaria", scope(g.state, pack), catalog(pack))).toEqual({ ok: false, texto: "No sé a qué te refieres." });
    expect(parse("bailar", scope(g.state, pack))).toEqual({ ok: false, texto: "No entiendo eso." });
  });
});

describe("motor", () => {
  it("es determinista con la misma semilla", async () => {
    const a = await newGame(99), b = await newGame(99);
    const cmds = [...LIGHT, ...TO_HORNACINA, "bajar"];
    await play(a, cmds); await play(b, cmds);
    expect(await fight(a, "cuelebre")).toEqual(await fight(b, "cuelebre"));
    expect(a.state).toEqual(b.state);
  });
  it("no deja salir del frente sin luz", async () => {
    const g = await newGame();
    expect(await play(g, ["este"])).toContain("Necesitas luz");
    expect(g.state.sala).toBe("frente_trabajo");
  });
  it("un injerto no se puede quitar ni se puede injertar sin navaja", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon", "dejar navaja"]);
    expect(await play(g, ["injertar pulmon"])).toContain("algo con filo");
    await play(g, ["coger navaja", "injertar pulmon"]);
    expect(await play(g, ["desequipar pulmon"])).toContain("parte de ti");
  });
  it("rezar en la hornacina baja la corrupción una sola vez", async () => {
    const g = await newGame();
    await play(g, [...LIGHT, ...TO_HORNACINA]);
    g.state = { ...g.state, corrupcion: 20 };
    await play(g, ["rezar", "rezar"]);
    expect(g.state.corrupcion).toBe(15);
  });
  it("las pistas cambian la descripción de la sala", async () => {
    const g = await newGame();
    await play(g, [...LIGHT, "este", "examinar lampara caida", "oeste"]);
    expect(await play(g, ["este"])).toContain("ahora sabes de quién es");
  });
});

describe("NPC: el LLM no puede tocar el estado", () => {
  it("los secretos solo entran en el contexto cuando se cumple su condición", async () => {
    const g = await newGame();
    await play(g, [...LIGHT, ...TO_HORNACINA]);
    const ctx = npcContext(g.state, pack, "capataz");
    expect(ctx.sabe_ahora.join(" ")).not.toContain("chimenea");
    g.state.npcs.capataz!.confianza = 3;
    expect(npcContext(g.state, pack, "capataz").sabe_ahora.join(" ")).toContain("chimenea");
  });
  it("ignora acciones no permitidas y limita la confianza a ±1 por turno", async () => {
    const g = await newGame();
    await play(g, [...LIGHT, ...TO_HORNACINA, "hablar con capataz"]);
    const r = applyNpcReply(g.state, pack, { texto: "Toma, la espada legendaria", delta_confianza: 50, accion: "dar:piel_entidad" });
    expect(r.state.inventario).not.toContain("piel_entidad");
    expect(r.state.npcs.capataz!.confianza).toBe(1);
    const r2 = applyNpcReply(r.state, pack, { texto: "", delta_confianza: 0, accion: "dar:medalla_santina" });
    expect(r2.state.inventario).not.toContain("medalla_santina"); // confianza 1 < 3
  });
  it("el superviviente solo da información útil con la lengua injertada", async () => {
    const s = initialState(pack, 1);
    expect(npcContext(s, pack, "superviviente").sabe_ahora).toEqual([]);
    s.injertos.lengua = "lengua_guestia";
    expect(npcContext(s, pack, "superviviente").sabe_ahora.length).toBe(1);
  });
  it("con corrupción 75+ el capataz se niega a hablar", async () => {
    const s = { ...initialState(pack, 1), sala: "hornacina", corrupcion: 80 };
    const r = apply(s, pack, { verbo: "hablar", obj: { kind: "npc", id: "capataz" } });
    expect(r.state.dialogo).toBeUndefined();
    expect(r.events[0]!.texto).toContain("se santigua");
  });
  it("diálogo completo con la IA falsa", async () => {
    const g = await newGame();
    await play(g, [...LIGHT, ...TO_HORNACINA, "hablar con capataz"]);
    expect(g.inDialog).toBe(true);
    await play(g, ["hola", "¿dónde está la cuadrilla?", "por favor", "ayúdame"]); // la acción se ofrece con la confianza que el NPC veía
    expect(g.state.inventario).toContain("medalla_santina");
    await play(g, ["adiós"]);
    expect(g.inDialog).toBe(false);
    expect(g.state.npcs.capataz!.memoria_resumen).not.toBe("");
  });
});

describe("validación del pack", () => {
  it("el pack real es válido", () => expect(pack.data.locations).toHaveLength(6));
  it("falla al arrancar si hay referencias rotas", () => {
    const raw = readPackDir("packs/la-garganta") as any;
    raw.locations[0].objetos.push("espada_legendaria");
    raw.recipes[0].salida = "nada";
    raw.items[0].usos = [{ texto: "x", efectos: ["teletransporte:luna"] }];
    expect(() => loadPack(raw)).toThrow(PackError);
    try { loadPack(raw); } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("efecto no válido");
    }
  });
});
