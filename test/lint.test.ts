import { describe, expect, it } from "vitest";
import { readPackDir } from "../src/cli/fsPack.js";
import { loadPack } from "../src/engine/pack.js";
import { lintPack } from "../src/engine/lint.js";

const raw = () => readPackDir("packs/la-garganta") as any;
const rules = (r: any) => lintPack(loadPack(r)).map((w) => w.regla);

describe("lint de diseño", () => {
  it("el pack real no tiene avisos", () => expect(rules(raw())).toEqual([]));

  it("sonido u olor sin etiqueta", () => {
    const r = raw();
    r.locations[0].hechos.push("a lo lejos se oye un martillo");
    expect(rules(r)).toContain("sentido-sin-etiqueta");
  });
  it("pieza injertable a la vista", () => {
    const r = raw();
    r.locations.find((l: any) => l.id === "galerias_viejas").objetos.push("ojo_topo");
    expect(rules(r)).toContain("injerto-a-la-vista");
  });
  it("dar un objeto sin decirlo", () => {
    const r = raw();
    r.items.find((i: any) => i.id === "cadaver_topo").usos[0].efectos = ["dar:ojo_topo"];
    expect(rules(r)).toContain("dar-en-silencio");
  });
  it("alias que faltan según la descripción", () => {
    const r = raw();
    const c = r.items.find((i: any) => i.id === "carburo");
    c.alias = ["carburo", "bote"];
    expect(rules(r)).toContain("alias-incompleto");
  });
  it("fijo sin motivo", () => {
    const r = raw();
    delete r.items.find((i: any) => i.id === "lampara_xuan").al_coger;
    expect(rules(r)).toContain("fijo-sin-razon");
  });
  it("poder que nadie comprueba", () => {
    const r = raw();
    r.items.find((i: any) => i.id === "lengua_guestia").poderes = ["entender", "volar"];
    expect(rules(r)).toContain("poder-sin-uso");
  });
  it("injerto sin núcleo neutro", () => {
    const r = raw();
    const o = r.items.find((i: any) => i.id === "ojo_topo");
    delete o.injerto_nucleo;
    o.texto_injerto = "Te injertas el ojo.";
    expect(rules(r)).toContain("injerto-sin-nucleo");
  });
  it("lo que aparece no se nombra en el texto", () => {
    const r = raw();
    r.items.find((i: any) => i.id === "piel_entidad").nombre = "la piel de Aquello";
    expect(rules(r)).toContain("aparece-sin-nombre");
  });
  it("NPC que suelta un dato sin condición", () => {
    const r = raw();
    r.npcs[0].sabe[0].si = [];
    expect(rules(r)).toContain("npc-sin-reticencia");
  });
  it("lint_ignorar acepta un caso a sabiendas", () => {
    const r = raw();
    const l = r.locations[0];
    l.hechos.push("a lo lejos se oye un martillo");
    l.lint_ignorar = ["sentido-sin-etiqueta"];
    expect(rules(r)).toEqual([]);
  });
});
