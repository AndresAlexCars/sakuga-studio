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
// Favoritos: ids guardados en este dispositivo (localStorage). Nunca lanzan error.
const FAV_KEY = 'sakuga.favs';

export function loadFavIds() {
  try {
    const list = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveFavIds(set) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch { /* modo privado */ }
}

export function onlyFavorites(items, favs, on) {
  return on ? items.filter((item) => favs.has(item.id)) : items;
}
