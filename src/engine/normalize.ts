// Normalización de texto para el parser: minúsculas, sin tildes, sin artículos.
const ARTICLES = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "lo"]);

export function stripAccents(s: string): string {
  // conserva la ñ
  return s.replace(/ñ/g, "\u0000").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\u0000/g, "ñ");
}

export function normalize(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/[¿?¡!.,;:"'()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w))
    .join(" ");
}
