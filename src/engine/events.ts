// Eventos que emite el motor. Todos llevan un texto fijo, de modo que el juego
// es jugable sin IA. El narrador puede reescribir los marcados como "clave".
export type EventType =
  | "sala_nueva" // primera visita: el narrador genera la descripción y se guarda
  | "sala" // visita repetida: descripción guardada + cambios
  | "texto" // texto fijo del pack o del motor
  | "error" // comando imposible ("No ves eso aquí")
  | "corrupcion"
  | "umbral" // se cruza un umbral de corrupción
  | "combate_inicio"
  | "golpe"
  | "enemigo_muerto"
  | "jugador_muerto"
  | "grupo" // reacción de la cuadrilla
  | "dialogo_inicio"
  | "npc_dice"
  | "dialogo_fin"
  | "final"
  | "mapa"; // texto preformateado: no se reparte en líneas

export interface GameEvent {
  tipo: EventType;
  texto: string;
  ref?: string; // id de sala, enemigo, NPC o final
  clave?: boolean; // el narrador IA puede reescribirlo
  detalle?: string; // salas: lista fija de objetos y salidas, que la IA nunca reescribe
  cabecera?: string; // salas: «Llegas a las galerías viejas.» / «Estás en…», antes de la prosa
}

export const KEY_EVENTS: ReadonlySet<EventType> = new Set(["combate_inicio", "enemigo_muerto", "jugador_muerto", "umbral", "final"]);

export function ev(tipo: EventType, texto: string, ref?: string): GameEvent {
  return { tipo, texto, ref, clave: KEY_EVENTS.has(tipo) || undefined };
}
