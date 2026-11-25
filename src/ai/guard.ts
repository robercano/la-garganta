// Validación barata de la prosa generada: no puede nombrar objetos del catálogo
// que no formen parte de los hechos de la sala.
import type { Pack } from "../engine/pack.js";
import { normalize } from "../engine/normalize.js";

export function proseIsSafe(prose: string, pack: Pack, roomId: string): boolean {
  const room = pack.location(roomId);
  const allowed = normalize([room.desc_base, ...room.hechos].join(" "));
  const text = normalize(prose);
  if (!text || text.length > 900) return false;
  for (const it of pack.data.items) {
    const name = normalize(it.nombre).replace(/^(tu|mi|su) /, "");
    if (name.split(" ").length < 2) continue; // nombres de una palabra dan demasiados falsos positivos
    if (text.includes(name) && !allowed.includes(name)) return false;
  }
  return true;
}
