// Filtros del historial. Funciones puras: no tocan el DOM, así se pueden probar.
export function filterHistory(items, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    String(item.prompt ?? '').toLowerCase().includes(q) ||
    String(item.style ?? '').toLowerCase().includes(q));
}

export function shortDate(iso, locale = 'es') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
}
