// Filtro previo en el servidor. Se suma al filtro de seguridad del proveedor.
// Esta app genera ilustraciones para todo público.

const normalize = (text) =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const ALWAYS_BLOCKED = [
  /\bloli(con)?s?\b/,
  /\bshota(con)?s?\b/,
  /\bcsam\b/,
  /\bped[oe]fil\w*/,
  /\bpedophil\w*/,
];

const SEXUAL = [
  /\bnsfw\b/,
  /\bporn\w*/,
  /\bhentai\b/,
  /\becchi\b/,
  /\berotic\w*/,
  /\bnud[eoa]s?\b/,
  /\bdesnud\w*/,
  /\bnaked\b/,
  /\btopless\b/,
  /\bnipples?\b/,
  /\bpezon(es)?\b/,
  /\bgenitals?\b/,
  /\bgenitales\b/,
  /\bsex(o|y|ual|ually|ualidad|ualmente)?\b/,
  /\bxxx\b/,
  /\blingerie\b/,
  /\blenceria\b/,
  /\bfetis\w*/,
  /\bfetich\w*/,
];

export function checkPrompt(prompt) {
  const text = normalize(prompt);
  if (ALWAYS_BLOCKED.some((re) => re.test(text)) || SEXUAL.some((re) => re.test(text))) {
    return 'Ese prompt no está permitido: la app genera ilustraciones para todo público.';
  }
  return null;
}
