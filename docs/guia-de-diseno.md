# Guía de diseño de aventuras

Reglas para escribir un pack (una aventura) que se juegue bien con este motor. Salen de probar *La Garganta*: cada una corresponde a un problema real que encontró un jugador.

Hay tres niveles de protección, de más a menos automático:

| Nivel | Dónde | Qué hace |
|---|---|---|
| Motor | `src/engine` | Lo que es general a todas las aventuras ya está resuelto en el código (decorado, sentidos, «atacar con», secretos, cabeceras…). No hay que hacer nada. |
| Lint | `npm run validate -- --strict` | Detecta en el pack lo que se puede comprobar solo. La CI falla si hay avisos. |
| Esta guía | aquí | Criterios de diseño que no se pueden automatizar. |

Al final hay una lista de comprobación para packs nuevos.

---

## 1. Principios (no negociables)

Vienen del documento de arquitectura y el motor los hace cumplir:

- Solo el motor escribe en el estado. La IA lee y propone.
- El pack es la única fuente de verdad: la IA no inventa nada con lo que se pueda interactuar.
- El texto libre solo existe en los diálogos con NPC.

De ahí sale la regla de oro de diseño: **el texto nunca promete algo que el motor no cumpla, y el motor nunca hace algo que el texto no cuente.**

## 2. Todo lo que el texto nombra se puede nombrar

El jugador escribe lo que lee. Si una sala dice «una fiambrera vacía», alguien escribirá `coger fiambrera`.

- **Decorado.** Lo que se menciona en los hechos o la descripción de una sala y merece mirarse es un objeto de tipo `escenario` (fijo, con `desc_base` y, si aporta, `examinar`). No sale en «Ves:» salvo que lleve `listar: true`.
- **Red de seguridad.** Lo que solo aparece en el texto sin ficha lo reconoce el motor como parte del sitio («Los entibos no te sirven para eso…»). Es un mínimo, no un sustituto: lo importante merece su ficha.
- **Lo que nombra una descripción** también se resuelve: «coger ojo» delante de los exvotos se refiere a los exvotos si su texto habla de un ojo.
- **Alias.** Incluye cómo llama al objeto su propio texto («piedras de carburo» → alias `piedras`) y los sinónimos obvios. El nombre ya cuenta, no hace falta repetirlo. *(Lint: `alias-incompleto`.)*
- **Lo fijo explica por qué.** Si algo no se puede coger y no es obvio, pon `al_coger` con un motivo que aporte («Lo que se le ofrece a la Santa no se toca: trae mal fario»). *(Lint: `fijo-sin-razon` para lo fijo que no es decorado.)*
- **Frases reales.** Cuando un jugador escriba algo que no se entiende, añádelo como alias o sinónimo, y como test.

## 3. Los sentidos

- Un hecho de sala que se oye o se huele lleva etiqueta: `"[oir] al fondo se oye gotear"`, `"[oler] huele a sebo quemado"`. El narrador lo recibe limpio y `escuchar` u `oler` lo devuelven. *(Lint: `sentido-sin-etiqueta`.)*
- Un disparador cuyo texto es un sonido lleva `"sentido": "oir"`, para que se siga oyendo después (el canto del túnel).
- Objetos, NPC y enemigos pueden tener `oir` y `oler` propios.
- Lo que cambia con el estado (voces con corrupción alta) va en `quest.ambiente`, con condición.

## 4. El motor no actúa en silencio

- **Nada entra en el inventario sin decirlo.** Una pieza que se saca de algo cae en la sala (`aparece:`) y se coge a mano. `dar:` solo cuando el texto dice «coges…» o lo da un NPC. *(Lint: `dar-en-silencio`.)*
- **Si el motor hace algo por su cuenta, lo anuncia:** «(Primero coges la lámpara.)», «El cuélebre aprovecha mientras cambias de arma».
- **Cada acción imposible tiene una respuesta que orienta** («Necesita carburo», «Necesitarías algo con filo»), nunca un «no» genérico si se puede evitar. Las herramientas en sus distintos estados deberían tener `usos` que digan qué les falta.

## 5. Descubrimiento y secretos

- **Las mecánicas especiales se descubren jugando.** Si un verbo o una estadística forma parte del misterio (injertos, corrupción), no sale en la ayuda, en `estado` ni en la barra hasta el primer contacto. El motor lo hace con los injertos y la corrupción.
- **El primer contacto es una escena, no una opción.** El primer injerto (el pulmón) lo fuerza la historia: al cogerlo te atrapa (`injerta_al_coger`). Ahí se anuncia el nuevo comando.
- **Lo valioso está escondido dentro de algo,** no a la vista: un cuerpo que se examina y se corta con la navaja. *(Lint: `injerto-a-la-vista`.)*
- **Lo más valioso cuesta más.** Va en otra sala o exige volver atrás, con **al menos dos pistas** en sitios distintos (la procesión sin lengua con «dientes como clavos de entibo» y el superviviente que balbucea «la serpe se la comió»). Las pistas reutilizan palabras exactas para que el jugador ate cabos.
- **Hay una ruta limpia.** Se puede llegar al mejor final con lo mínimo obligatorio. Lo demás son atajos o tentaciones.
- **Los recursos que se gastan una vez no se gastan sin efecto** (rezar sin corrupción no consume el rezo).

## 6. El mapa

- Cada sala tiene `mapa: {nivel, x, y, etiqueta}`. Norte es arriba (y menor) y los niveles van de arriba abajo. Cada nivel tiene nombre en `quest.niveles`.
- **Las salidas cuadran con el mapa:** `norte` lleva a una sala al norte del mismo nivel, y `subir`/`bajar` cambian de nivel. El pack falla si no.
- Los pasos raros (grietas, simas) usan `entrar`/`salir`, que no tienen dirección.
- Un callejón sin salida es una salida sin `a`, con su condición y su `bloqueo`. No apunta a ninguna sala, para que el mapa no lo dibuje como camino.
- Las etiquetas del mapa son cortas (≤ 10 caracteres).

## 7. Combate y tiempo

- Cualquier acción en combate gasta el turno y el enemigo responde. Cambiar de arma en combate tiene coste: premia ir preparado.
- `atacar X con Y` empuña Y si hace falta, con ese coste.
- El daño y la vida se ajustan simulando cientos de partidas con distintas semillas (ver los tests), no a ojo. Objetivo para el primer combate: muy pocas muertes y llegar tocado.

## 8. Redacción

- **Segunda persona,** sobria, con humor seco y oscuro.
- **Nombres de sala con artículo y en minúscula tras él** («El frente de trabajo», «La Garganta»). El motor escribe «Llegas al frente de trabajo.» o «Estás en…».
- **Los textos fijos de los NPC** (saludo, respuestas de reserva) suenan a su personaje. Son lo que se ve si la IA falla.
- **Lo grotesco se insinúa con detalle concreto,** no con adjetivos («un ojo sin pupila», «los dedos se abren y se cierran solos»).

## 9. Pruebas

- **`soluciones.json`:** al menos una partida por cada final que no sea de derrota, con su semilla. Comandos normales, más `@luchar X` para combatir hasta el final y `# comentario`. Un test genérico las juega en todos los packs.
- **Lint estricto:** `npm run validate -- --strict`, sin avisos. Si un aviso es un falso positivo a sabiendas, se acepta con `lint_ignorar` en ese objeto o sala, nunca desactivando la regla.
- **Cada problema que encuentre un jugador** se convierte en algo permanente en el mismo cambio: una regla del motor si es general, una regla del lint si se puede detectar o una entrada en esta guía si es de criterio. Y un test.

---

## Lista de comprobación para un pack nuevo

- [ ] Cada sustantivo de los hechos que el jugador pueda querer mirar tiene ficha de decorado.
- [ ] Alias con las palabras de la propia descripción y los sinónimos obvios.
- [ ] Lo fijo que no es obvio tiene `al_coger`.
- [ ] Sonidos y olores etiquetados; los disparadores sonoros llevan `sentido`.
- [ ] Ninguna pieza valiosa a la vista; la más valiosa, con dos pistas en otras salas.
- [ ] Las mecánicas secretas no se mencionan antes de descubrirse.
- [ ] Mapa: niveles con nombre, posiciones y salidas coherentes.
- [ ] Hay ruta limpia al mejor final.
- [ ] `soluciones.json` cubre todos los finales.
- [ ] `npm run validate -- --strict` y `npm test` pasan.
- [ ] Una persona lo ha jugado de principio a fin, y lo que dijo está incorporado.
