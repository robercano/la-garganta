# La Garganta

Aventura conversacional con IA (MVP). Pozo Santa Bárbara, Asturias, 1923: se va la luz, la cuadrilla se ha ido... o eso parece.

Arquitectura: ver el documento «Aventura conversacional con IA — Arquitectura MVP» en el proyecto de Claude. Regla de oro: **solo el motor escribe en el estado**; los LLM leen y proponen.

## Uso

```bash
npm install
npm run play                 # jugar en la terminal con la IA falsa (sin tokens)
npm run play -- --seed 42    # partida reproducible
npm run validate             # valida el pack (Zod + referencias + mapa) y pasa el lint de diseño
npm run validate -- --strict # igual, pero los avisos de diseño fallan (así corre la CI)
npm test                     # tests, incluidas las soluciones de cada pack (soluciones.json)
npm run typecheck
```

## Jugar con Claude (Haiku)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run play -- --ia claude             # narrador y NPC con claude-haiku-5-5; «coste» muestra el gasto
npm run coste -- --ia claude            # juega todas las soluciones y mide tokens y coste por partida
```

Cada llamada queda registrada (tokens, caché, latencia, coste) en `logs/` (no se sube al repo). Los precios por modelo se configuran en `src/ai/cost.ts`; hasta entonces el coste sale como «sin precio» y solo se cuentan tokens. Si la API falla, el juego sigue con los textos fijos del pack. La web publicada sigue usando la IA falsa: la key nunca va al navegador; la IA real llegará a la web con el Worker.

## Diseñar una aventura

Lee [`docs/guia-de-diseno.md`](docs/guia-de-diseno.md): reglas aprendidas jugando, el lint que las comprueba y una lista de comprobación para packs nuevos. Cada pack incluye `soluciones.json` con una partida por final, y un test genérico las juega.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `packs/la-garganta/` | El pack: única fuente de verdad (salas, objetos, recetas, NPC, enemigo, finales) |
| `src/engine/` | Motor determinista sin IA: esquemas Zod, parser en español, reglas, combate con semilla, diálogo (lado motor) |
| `src/ai/` | Contratos con los LLM, IA falsa y validación de la prosa generada |
| `src/session/` | Une parser, motor e IA; lo usarán la CLI y el Durable Object |
| `src/cli/` | Jugar y validar desde la terminal |
| `src/worker/` | (pendiente) Cloudflare Worker + Durable Object por partida |
| `web/` | (pendiente) Frontend de terminal retro |

## Mini-lenguaje del pack

Condiciones (todas deben cumplirse): `flag:x`, `!flag:x`, `tiene:item`, `poder:p`, `injerto:slot|item`, `en:sala`, `visitada:sala`, `muerto:enemigo`, `grupo:cuadrilla=sigue|sigue_recelo`, `corrupcion>=25`, `vida<=0`, `confianza>=3`.

Efectos: `flag:x`, `!flag:x`, `corrupcion+10`, `corrupcion-5`, `vida+5`, `dar:item`, `quitar:item`, `aparece:item`, `ir:sala`.

Sentidos («escuchar» y «oler»): un hecho de sala puede empezar por `[oir]` u `[oler]` (el narrador lo recibe sin la etiqueta); un disparador `al_entrar` puede llevar `"sentido": "oir"` para que su texto se siga oyendo; objetos, NPC y enemigos pueden tener `oir`/`oler`; y `quest.ambiente` añade percepciones con condición (p. ej. con corrupción alta).

## Notas de diseño

- La prosa de cada sala (la genera el narrador una vez por partida) solo describe tono y hechos; la lista de objetos, personajes y salidas la añade siempre el motor. Así la IA no puede inventar nada interactuable.
- La cuadrilla no tiene diálogo libre: su reacción depende de la corrupción (bandas en `quest.json`) y se recalcula en cada injerto mientras te sigue.
