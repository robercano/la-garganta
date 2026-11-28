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
- **Lo que aparece también se puede mirar.** Si un texto revela algo nuevo (un hueco tras un derrumbe, una hornacina), ese algo tiene su ficha de decorado con `visible_si` sobre el mismo flag, y la sala lo menciona en `cambios`.
- **Lo que nombra una descripción** también se resuelve: «coger ojo» delante de los exvotos se refiere a los exvotos si su texto habla de un ojo.
- **El núcleo manda.** El parser trata la primera palabra como el sustantivo: «hueso diminuto» busca un hueso, no cualquier cosa «diminuta». Lo que nombra la descripción de cualquier objeto presente (el hueso del relicario) se refiere a ese objeto. Por eso los alias empiezan por el sustantivo («altar diminuto», no «diminuto altar»).
- **Alias.** Incluye cómo llama al objeto su propio texto («piedras de carburo» → alias `piedras`) y los sinónimos obvios. El nombre ya cuenta, no hace falta repetirlo. *(Lint: `alias-incompleto`.)*
- **Lo fijo explica por qué.** Si algo no se puede coger y no es obvio, pon `al_coger` con un motivo que aporte («Lo que se le ofrece a la Santa no se toca: trae mal fario»). *(Lint: `fijo-sin-razon` para lo fijo que no es decorado.)*
- **Frases reales.** Cuando un jugador escriba algo que no se entiende, añádelo como alias o sinónimo, y como test.

## 3. Los sentidos

- Un hecho de sala que se oye o se huele lleva etiqueta: `"[oir] al fondo se oye gotear"`, `"[oler] huele a sebo quemado"`. El narrador lo recibe limpio y `escuchar` u `oler` lo devuelven. *(Lint: `sentido-sin-etiqueta`.)*
- Un disparador cuyo texto es un sonido lleva `"sentido": "oir"`, para que se siga oyendo después (el canto del túnel).
- Objetos, NPC y enemigos pueden tener `oir` y `oler` propios.
- Lo que cambia con el estado va con condición: en la sala, en `percepciones` (con la lengua injertada se entiende lo que rezan las paredes), o en todas, en `quest.ambiente` (voces con corrupción alta).
- Si algo se va a entender más tarde, antes se tiene que oír sin entenderse (las paredes «murmuran en una lengua que no conoces»). El jugador nota el cambio.

## 4. El motor no actúa en silencio

- **Nada entra en el inventario sin decirlo.** Una pieza que se saca de algo cae en la sala (`aparece:`) y se coge a mano. `dar:` solo cuando el texto dice «coges…» o lo da un NPC. *(Lint: `dar-en-silencio`.)*
- **Lo que aparece se llama como lo nombra el texto que lo hace aparecer.** Si el texto dice «el jirón cae a tus pies», el objeto se llama «un jirón…», no «la piel de Aquello». El nombre literario puede ir en la descripción y en los alias. *(Lint: `aparece-sin-nombre`, también para el botín de los enemigos.)*
- **Nada sale de la nada.** Lo que el personaje lleva al empezar se cuenta en la intro, y el texto de una receta nombra lo que usa («agua de la cantimplora»). *(Lint: `inicio-sin-contar`, `receta-sin-nombrar`.)*
- **Si hay duda entre el decorado y algo que se puede coger,** los verbos de manipular (coger, injertar, usar…) eligen lo que se puede coger. Lo hace el motor.
- **Si el motor hace algo por su cuenta, lo anuncia:** «(Primero coges la lámpara.)», «El cuélebre aprovecha mientras cambias de arma».
- **Cada acción imposible tiene una respuesta que orienta** («Necesita carburo», «Necesitarías algo con filo»), nunca un «no» genérico si se puede evitar. Las herramientas en sus distintos estados deberían tener `usos` que digan qué les falta.

## 5. Descubrimiento y secretos

- **Las mecánicas especiales se descubren jugando.** Si un verbo o una estadística forma parte del misterio (injertos, corrupción), no sale en la ayuda, en `estado` ni en la barra hasta el primer contacto. El motor lo hace con los injertos y la corrupción.
- **El primer contacto es una escena, no una opción.** El primer injerto (el pulmón) lo fuerza la historia: al cogerlo te atrapa (`injerta_al_coger`). Ahí se anuncia el nuevo comando.
- **Todo poder se nota en el mundo.** Si un injerto u objeto da un poder («el balbuceo de las paredes tiene gramática»), varias salas tienen que reaccionar a él: salidas, percepciones, NPC o usos con `poder:x`. Lo que se entiende debe aportar pistas o historia, no solo ambiente. *(Lint: `poder-sin-uso`.)* Un injerto solo da su poder cuando está injertado, no por llevarlo encima.
- **Los NPC no sueltan nada a la primera.** Cada dato tiene condición, como mínimo `confianza>=1`, y lo importante, más. El prompt les pide contar una sola cosa por respuesta, solo si les preguntan y después de esquivar. Que se note que se lo estás sonsacando. *(Lint: `npc-sin-reticencia`.)*
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
- **La voz cambia con la corrupción.** Los injertos se escriben con `injerto_nucleo`: solo lo físico, en tono neutro. El motor lo envuelve con la voz de la fase en que está el personaje (`quest.voz_injerto`): primero repulsión, luego arrebatos sin control y, al final, una calma que suena a la propia mina. El horror va de fuera hacia dentro y el jugador nota su caída sin mirar números. Si una combinación queda floja, `texto_injerto_fase` la sustituye para esa fase. Solo las escenas forzadas (el pulmón) llevan texto propio. *(Lint: `injerto-sin-nucleo`.)*
- **Lo grotesco se insinúa con detalle concreto,** no con adjetivos («un ojo sin pupila», «los dedos se abren y se cierran solos»).

## 9. Pruebas

- **`soluciones.json`:** al menos una partida por cada final que no sea de derrota, con su semilla. Comandos normales, más `@luchar X` para combatir hasta el final y `# comentario`. Un test genérico las juega en todos los packs.
- **Lint estricto:** `npm run validate -- --strict`, sin avisos. Si un aviso es un falso positivo a sabiendas, se acepta con `lint_ignorar` en ese objeto o sala, nunca desactivando la regla.
- **Cada problema que encuentre un jugador** se convierte en algo permanente en el mismo cambio: una regla del motor si es general, una regla del lint si se puede detectar o una entrada en esta guía si es de criterio. Y un test.

## 10. Lecciones de la primera partida completa (La Garganta, 27 nov 2026)

Lo que hay detrás de las reglas anteriores, para aplicarlo a cualquier juego:

1. **El texto es la interfaz; cada sustantivo es una promesa.** Casi todos los fallos fueron el mismo: el texto decía algo que el motor no cumplía (la fiambrera, el ojo de los exvotos, la hornacina, el hueso, el jirón, el canto). El jugador prueba las palabras que acaba de leer.
2. **El jugador habla con sustantivos y con lo último que ha leído.** El parser busca primero en el texto que el jugador tiene delante y fija el sustantivo (núcleo) antes que los adjetivos.
3. **El motor no actúa en silencio.** La automatización que se ve ayuda («Primero coges…»); la que no se ve parece un error.
4. **El misterio también vive en la interfaz.** Ayuda, estado y barra tienen que callar tanto como el narrador.
5. **Lo que se gana se nota y lo que se esconde deja rastro.** Un poder que no cambia nada parece un error; lo valioso escondido necesita pistas que repiten palabras.
6. **La voz evoluciona con el estado.** La caída se cuenta con el tono, no con números.

Sobre el proceso:
- **La partida humana es insustituible:** en un día encontró unos quince problemas que ningún test veía. Se juega primero con la IA falsa (gratis y rápida) y después se le pone voz. Este bucle se mantiene con la IA real.
- **Cada problema se convierte en motor, lint o guía, con test.** Al crear el lint se encontraron tres errores más que nadie había visto.
- **Lo que se puede validar no se dibuja ni se revisa a mano** (el mapa no puede mentir porque el pack falla).

Para el próximo juego, desde el primer día:
- Escribir `soluciones.json` junto con el mapa, antes que los textos.
- Dar ficha de decorado a cada sustantivo mientras se escribe.
- Hacer una partida humana completa antes de conectar la IA.
- En producción, registrar cada «No sé a qué te refieres» y cada «No entiendo eso» con la frase exacta (métrica del MVP) y convertirlos en alias o reglas.

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
- [ ] `soluciones.json` escrito junto con el mapa, antes que los textos.
- [ ] Una persona lo ha jugado de principio a fin con la IA falsa, y lo que dijo está incorporado antes de conectar la IA real.
