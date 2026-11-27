import { describe, expect, it } from "vitest";
import { newGame, play, fight, LIGHT, TO_HORNACINA } from "./helpers.js";

describe("La Garganta: partidas completas", () => {
  it("ruta limpia: un solo injerto y sales con la cuadrilla", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "coger orujo", "bajar"]);
    expect(g.state.combate?.enemigo).toBe("cuelebre");
    await fight(g, "cuelebre");
    expect(g.state.enemigos.cuelebre!.vivo).toBe(false);
    await play(g, ["coger pulmon", "injertar pulmon"]);
    expect(g.state.corrupcion).toBe(15);
    const out = await play(g, ["norte", "bajar"]);
    expect(out).toContain("Sabíamos que no nos dejarías");
    expect(g.state.grupo?.estado).toBe("sigue");
    const end = await play(g, ["subir"]);
    expect(g.state.final).toBe("con_cuadrilla");
    expect(end).toContain("Amanece sobre el valle");
  });

  it("injertarse delante de la cuadrilla te la quita: huyen", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon", "cortar cuelebre", "coger lengua", "norte", "cortar cosa", "coger brazo", "bajar"]);
    expect(g.state.grupo?.estado).toBe("sigue");
    await play(g, ["injertar brazo"]); // 35: siguen, con recelo
    expect(g.state.grupo?.estado).toBe("sigue_recelo");
    const out = await play(g, ["injertar lengua"]); // 60: huyen
    expect(out).toContain("echa a correr");
    expect(g.state.grupo?.estado).toBe("huida");
    await play(g, ["subir"]);
    expect(g.state.final).toBe("solo");
  });

  it("con 70 al llegar, la cuadrilla huye nada más verte", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon", "cortar cuelebre", "coger lengua", "norte", "cortar topo", "coger ojo", "injertar ojo", "cortar cosa", "coger brazo", "injertar brazo", "injertar lengua"]);
    expect(g.state.corrupcion).toBe(70);
    const out = await play(g, ["bajar"]);
    expect(g.state.grupo?.estado).toBe("huida");
    expect(out).toContain("echa a correr");
  });

  it("llegar a 100 de corrupción es el final de fusión", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon", "cortar cuelebre", "coger lengua", "norte", "cortar topo", "coger ojo", "injertar ojo", "cortar cosa", "coger brazo", "injertar brazo", "injertar lengua", "bajar", "cortar membrana", "coger piel"]);
    const out = await play(g, ["injertar piel"]);
    expect(g.state.final).toBe("fusion");
    expect(out).toContain("Ya no hay un tú y una mina");
  });

  it("con 75+ al llegar, la cuadrilla es hostil y te hace daño cada turno", async () => {
    const g = await newGame(42);
    await play(g, [...LIGHT, ...TO_HORNACINA, "bajar"]);
    await fight(g, "cuelebre");
    await play(g, ["coger pulmon", "cortar cuelebre", "coger lengua", "norte", "cortar topo", "coger ojo", "injertar ojo", "cortar cosa", "coger brazo", "injertar brazo", "injertar lengua"]);
    g.state = { ...g.state, corrupcion: 80, vida: 12 };
    const before = g.state.vida;
    const out = await play(g, ["bajar"]);
    expect(g.state.grupo?.estado).toBe("hostil");
    expect(out).toContain("Vienen a por ti");
    await play(g, ["esperar"]);
    expect(g.state.vida).toBeLessThan(before);
    await play(g, ["atacar cuadrilla", "subir"]);
    expect(g.state.final).toBe("solo_oscuro");
  });

  it("morir en combate termina la partida", async () => {
    const g = await newGame(3);
    await play(g, [...LIGHT, "desequipar pico", "desequipar casco", ...TO_HORNACINA, "bajar"]);
    g.state = { ...g.state, vida: 1 };
    await fight(g, "cuelebre");
    expect(g.state.final).toBe("muerte");
    expect(await play(g, ["mirar"])).toContain("La partida ha terminado");
  });
});
