import { describe, expect, it } from "vitest";
import { newGame, play, fight, pack, LIGHT, TO_HORNACINA } from "./helpers.js";
import { parse } from "../src/engine/parser.js";
import { scope, catalog, apply, mapData } from "../src/engine/engine.js";
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
    await play(g, ["coger pulmon", "norte", "cortar topo", "coger ojo", "dejar navaja"]);
    expect(await play(g, ["injertar ojo"])).toContain("algo con filo");
    await play(g, ["coger navaja", "injertar ojo"]);
    expect(g.state.injertos.ojo).toBe("ojo_topo");
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

describe("usar y combinar sin coger antes", () => {
  for (const cmd of ["usar lámpara con bote", "usar carburo con lampara", "usar lámpara de carburo con bote de carburo", "combinar lampara con carburo"]) {
    it(`«${cmd}» coge lo que haga falta y carga la lámpara`, async () => {
      const g = await newGame();
      const out = await play(g, [cmd]);
      expect(out).toContain("Primero coges");
      expect(g.state.inventario).toContain("lampara_cargada");
    });
  }
  it("también al empuñar algo del suelo", async () => {
    const g = await newGame();
    await play(g, ["equipar pico"]);
    expect(g.state.equipo.mano).toBe("pico");
  });
});

describe("frases reales de Rob", () => {
  it("«usar piedras de carburo con lámpara de carburo» carga la lámpara", async () => {
    const g = await newGame();
    await play(g, ["coger lampara", "coger carburo", "usar piedras de carburo con lámpara de carburo"]);
    expect(g.state.inventario).toContain("lampara_cargada");
  });
  it("«encender lámpara» da una pista según el estado", async () => {
    const g = await newGame();
    expect(await play(g, ["coger lampara", "encender lámpara de carburo"])).toContain("Necesita carburo");
    expect(await play(g, ["combinar lampara con carburo", "encender lampara"])).toContain("sin agua");
  });
  it("«equipar lámpara» explica que basta con llevarla", async () => {
    const g = await newGame();
    expect(await play(g, ["coger lampara", "equipar lámpara de carburo"])).toContain("basta con llevarla");
  });
});

describe("decorado: lo que el texto nombra no da respuestas genéricas", () => {
  it("la fiambrera tiene descripción propia y no se lleva", async () => {
    const g = await newGame();
    await play(g, LIGHT);
    expect(await play(g, ["examinar fiambrera"])).toContain("Manolón");
    expect(await play(g, ["coger la fiambrera"])).toContain("No merece la pena cargar con una fiambrera vacía");
  });
  it("el decorado no aparece en la lista de objetos", async () => {
    const g = await newGame();
    const out = await play(g, LIGHT.slice(0, 4));
    expect(out).not.toMatch(/Ves:.*fiambrera/);
  });
  it("lo que solo está en el texto de la sala se reconoce como parte del sitio", async () => {
    const g = await newGame();
    await play(g, LIGHT);
    expect(await play(g, ["examinar la sidra"])).toContain("Te fijas en");
    expect(await play(g, ["coger pájaro"])).toBe("No sé a qué te refieres.");
  });
  it("a oscuras no se reconoce nada que no se pueda tocar", async () => {
    const g = await newGame();
    expect(await play(g, ["coger fiambrera"])).toBe("No ves eso por aquí.");
  });
});

describe("sentidos: escuchar y oler", () => {
  it("el canto del túnel se sigue oyendo al escuchar", async () => {
    const g = await newGame();
    await play(g, [...LIGHT, "este"]);
    const out = await play(g, ["escuchar"]);
    expect(out).toContain("rosario de la Santina");
    expect(out).toContain("cruje");
  });
  it("el narrador recibe los hechos sin etiqueta", () => {
    const h = pack.location("frente_trabajo").hechos.join(" ");
    expect(h).not.toContain("[oir]");
    expect(pack.location("frente_trabajo").percepcion.oir[0]).toContain("gotear");
  });
  it("se oye y se huele al enemigo y a los NPC presentes, también a oscuras", async () => {
    const g = await newGame();
    expect(await play(g, ["escuchar"])).toContain("gotear");
    await play(g, [...LIGHT, ...TO_HORNACINA]);
    expect(await play(g, ["oler"])).toContain("orujo y a miedo");
  });
  it("con corrupción alta aparecen percepciones nuevas", async () => {
    const g = await newGame();
    g.state = { ...g.state, corrupcion: 80 };
    expect(await play(g, ["escuchar"])).toContain("tu nombre");
  });
  it("una etiqueta de sentido mal escrita falla al cargar el pack", () => {
    const raw = readPackDir("packs/la-garganta") as any;
    raw.locations[0].hechos.push("[olfato] huele raro");
    expect(() => loadPack(raw)).toThrow(PackError);
    raw.locations[0].hechos.splice(-1, 1, "[oir]");
    expect(() => loadPack(raw)).toThrow(PackError);
  });
});

describe("mapa", () => {
  it("muestra el nivel actual, lo explorado y lo intuido; no gasta turno", async () => {
    const g = await newGame();
    let m = mapData(g.state, pack)!;
    expect(m.actual).toBe(1);
    expect(m.niveles.map((n) => n.nivel)).toEqual([1]);
    expect(m.niveles[0]!.salas.find((r) => r.id === "frente_trabajo")!.estado).toBe("actual");
    expect(m.niveles[0]!.salas.find((r) => r.id === "tunel_servicio")!.estado).toBe("intuida");
    await play(g, [...LIGHT, ...TO_HORNACINA]);
    m = mapData(g.state, pack)!;
    expect(m.actual).toBe(2);
    expect(m.niveles.map((n) => n.nombre)).toEqual(["la galería del frente", "la capilla", "el pozo inundado"]);
    const capilla = m.niveles[1]!.salas[0]!;
    expect(capilla).toMatchObject({ estado: "actual", sube: true, baja: true });
    expect(m.niveles[0]!.tuneles).toEqual([{ a: "frente_trabajo", b: "tunel_servicio" }]);
    const turno = g.state.turno;
    expect(await play(g, ["mapa"])).toContain("nivel 2: la capilla");
    expect(g.state.turno).toBe(turno);
  });
  it("el pozo y las galerías están en el mismo nivel, unidos de norte a sur", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon", "injertar pulmon", "norte"]);
    const n3 = mapData(g.state, pack)!.niveles.find((n) => n.nivel === 3)!;
    const pozo = n3.salas.find((r) => r.id === "pozo_inundado")!, gal = n3.salas.find((r) => r.id === "galerias_viejas")!;
    expect(pozo.x).toBe(gal.x);
    expect(pozo.y).toBeGreaterThan(gal.y);
    expect(n3.tuneles).toHaveLength(1);
  });
  it("la grieta oculta se toma con «entrar» y baja de la capilla a las galerías", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon", "injertar pulmon", "norte", "cortar topo", "coger ojo", "injertar ojo", "salir por la grieta"]);
    expect(g.state.sala).toBe("hornacina");
    await play(g, ["entrar en la grieta"]);
    expect(g.state.sala).toBe("galerias_viejas");
  });
  it("una salida que contradice el mapa hace fallar el pack", () => {
    const raw = readPackDir("packs/la-garganta") as any;
    const pozo = raw.locations.find((l: any) => l.id === "pozo_inundado");
    pozo.salidas.este = pozo.salidas.norte;
    delete pozo.salidas.norte;
    expect(() => loadPack(raw)).toThrow(/no está al este/);
  });
});

describe("lo que nombra la descripción de un decorado", () => {
  it("«coger ojo» en la capilla se refiere a los exvotos y da mal fario", async () => {
    const g = await newGame();
    await play(g, [...LIGHT, ...TO_HORNACINA, "examinar exvotos"]);
    expect(await play(g, ["coger ojo"])).toContain("mal fario");
    expect(await play(g, ["examinar los órganos"])).toContain("demasiados lóbulos");
    expect(await play(g, ["coger la santa"])).toContain("Ni en sueños");
  });
});

describe("estado", () => {
  it("muestra lo equipado y los injertos", async () => {
    const g = await newGame();
    await play(g, LIGHT);
    const out = await play(g, ["estado"]);
    expect(out).toMatch(/Equipado: .*el pico \(mano\)/);
    expect(out).toMatch(/Equipado: .*el casco de cuero \(cabeza\)/);
    expect(out).not.toContain("Injertos"); // no se sabe que existen hasta el primero
  });
});

describe("atacar con un arma", () => {
  const toPozo = ["coger lampara", "coger carburo", "combinar lampara con carburo", "combinar lampara con cantimplora", "coger pico", ...TO_HORNACINA, "bajar"];
  const strikes = (out: string) => (out.match(/\(-\d+ vida\)|falla por poco/g) ?? []).length;

  it("con el arma ya en la mano, el enemigo responde una vez", async () => {
    const g = await newGame(5);
    await play(g, [...toPozo, "equipar pico"]); // equipar en combate ya cuesta un golpe
    const out = await play(g, ["atacar cuelebre con el pico"]);
    expect(out).not.toContain("aprovecha");
    expect(strikes(out)).toBe(1);
  });
  it("si hay que empuñarla en pleno combate, el enemigo aprovecha y golpea de más", async () => {
    const g = await newGame(5);
    await play(g, toPozo);
    expect(g.state.equipo.mano).toBeUndefined();
    const out = await play(g, ["atacar al cuélebre con el pico"]);
    expect(out).toContain("aprovecha mientras cambias de arma");
    expect(strikes(out)).toBe(2);
    expect(g.state.equipo.mano).toBe("pico");
  });
  it("la navaja sirve de arma débil y se puede cambiar por el pico", async () => {
    const g = await newGame(5);
    await play(g, toPozo);
    await play(g, ["atacar cuelebre con navaja"]);
    expect(g.state.equipo.mano).toBe("navaja");
    await play(g, ["atacar cuelebre con pico"]);
    expect(g.state.equipo.mano).toBe("pico");
    expect(g.state.inventario).toContain("navaja");
  });
  it("no se pelea con cualquier cosa", async () => {
    const g = await newGame(5);
    await play(g, toPozo);
    expect(await play(g, ["atacar cuelebre con la lampara"])).toContain("No vas a pelear con");
  });
});

describe("los injertos son un secreto hasta el primero", () => {
  it("antes del pulmón, «injertar» no existe ni sale en la ayuda", async () => {
    const g = await newGame();
    expect(await play(g, ["ayuda"])).not.toContain("injertar");
    expect(await play(g, ["injertar lampara"])).toBe("No entiendo eso.");
  });
  it("al coger el pulmón, te atrapa y se injerta solo, aunque no lleves navaja", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["dejar navaja"]);
    const out = await play(g, ["coger el pulmón"]);
    expect(out).toContain("se abre paso entre dos costillas");
    expect(out).toContain("Nuevo comando: injertar X");
    expect(g.state.injertos.pulmon).toBe("pulmon_cuelebre");
    expect(g.state.corrupcion).toBe(15);
    expect(await play(g, ["ayuda"])).toContain("injertar X");
    expect(await play(g, ["estado"])).toContain("Injertos: el pulmón del cuélebre (pulmón)");
  });
});

describe("la corrupción también es secreta hasta el primer injerto", () => {
  it("no sale en estado ni al rezar sin corrupción; sí después del pulmón", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA]);
    expect(await play(g, ["estado"])).not.toContain("Corrupción");
    expect(await play(g, ["rezar"])).not.toContain("Corrupción");
    await play(g, ["bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon"]);
    expect(await play(g, ["estado"])).toContain("Corrupción 15/100");
  });
});

describe("cabecera de sala", () => {
  it("«Llegas a…» al entrar y «Estás en…» al mirar, con contracción", async () => {
    const g = await newGame();
    await play(g, LIGHT);
    expect(await play(g, ["este"])).toContain("Llegas al túnel de servicio.");
    expect(await play(g, ["mirar"])).toContain("Estás en el túnel de servicio.");
    expect(await play(g, ["bajar"])).toContain("Llegas a la hornacina de Santa Bárbara.");
  });
});

describe("las piezas están escondidas", () => {
  async function toGalerias() {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon"]);
    return g;
  }
  it("en las galerías se ven los cuerpos, no las piezas", async () => {
    const g = await toGalerias();
    const out = await play(g, ["norte"]);
    expect(out).toContain("el cadáver de un topo enorme");
    expect(out).not.toMatch(/Ves:.*(ojo|brazo|lengua)/);
  });
  it("examinar el topo descubre el ojo y la navaja lo saca", async () => {
    const g = await toGalerias();
    await play(g, ["norte"]);
    expect(await play(g, ["examinar topo"])).toContain("El ojo lo tiene en el paladar");
    expect(await play(g, ["sacar el ojo"])).toContain("chasquido húmedo");
    expect(g.state.inventario).not.toContain("ojo_topo"); // queda en el suelo: hay que cogerlo
    await play(g, ["coger ojo"]);
    expect(g.state.inventario).toContain("ojo_topo");
    expect(await play(g, ["cortar topo"])).toBe("Ya no queda nada que sacar de ahí.");
  });
  it("sin navaja no se corta nada", async () => {
    const g = await toGalerias();
    await play(g, ["dejar navaja", "norte"]);
    expect(await play(g, ["cortar cosa"])).toBe("Necesitarías algo con filo.");
  });
  it("la lengua está en la tripa del cuélebre, con pistas en la procesión", async () => {
    const g = await toGalerias();
    await play(g, ["norte"]);
    expect(await play(g, ["examinar procesion"])).toContain("clavos de entibo");
    await play(g, ["sur"]);
    expect(await play(g, ["examinar cuelebre"])).toContain("tripa hinchada");
    expect(await play(g, ["abrir la tripa del cuelebre con la navaja"])).toContain("sigue rezando");
    expect(await play(g, ["coger lengua"])).toContain("Coges la lengua");
    expect(g.state.inventario).toContain("lengua_guestia");
  });
});
