# La Garganta: instrucciones para trabajar en este repo

Aventura conversacional con IA (MVP). Responde y escribe en español.

## Antes de tocar nada
- Arquitectura: el documento «Aventura conversacional con IA — Arquitectura MVP» (proyecto de Claude) y el README. Principios no negociables: solo el motor escribe en el estado; el pack es la fuente de verdad; texto libre solo en diálogos con NPC (≤200 caracteres, como mensaje de usuario); los NPC responden en JSON y el motor valida sus acciones.
- Para crear o modificar un pack (`packs/*`): lee y sigue `docs/guia-de-diseno.md`.

## Al terminar cualquier cambio
```bash
npm run typecheck
npm test                          # incluye las soluciones de todos los packs y el lint
npm run validate -- --strict      # sin avisos de diseño
npm run build:web                 # si cambia algo que se ve en la web
```

## Regla de mejora continua
Cada problema que salga al jugar (un comando que no se entiende, un texto que promete algo, una mecánica que se delata) se resuelve **y se generaliza en el mismo cambio**:
1. **Motor** (`src/engine`), si es general a cualquier aventura.
2. **Lint** (`src/engine/lint.ts`), si se puede detectar en el pack.
3. **Guía** (`docs/guia-de-diseno.md`), si es de criterio.

Además, añade un test con la frase o el caso real. No arregles solo el síntoma en el pack.

## Convenciones
- `src/engine` no depende de IA. `src/ai` contiene los contratos y la IA falsa. `src/session` lo une todo.
- Commits en español, con el porqué.
- Avisa antes de decidir por tu cuenta algo distinto de lo que se pidió.
