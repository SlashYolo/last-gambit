/* Player profile: settings, statistics, achievements and the saved run.
   In the desktop app it lives in profile.json in the app data folder (Tauri store plugin);
   in a browser it falls back to localStorage. */
const KEY = 'last-gambit-profile-v1';
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const defaults = () => ({
  v: 1,
  settings: { lang: null, sound: true, volume: 0.8, badges: true, colors: 'type', crt: true, fullscreen: false },
  stats: {
    runs: 0, solved: 0, mates: 0, stalemates: 0, exact: 0, bestAnte: 0, bestWins: 0, goldEarned: 0,
    promotions: 0, bosses: 0, trainingSolved: 0, hints: 0, playSeconds: 0
  },
  ach: {},
  run: null
});

export const profile = defaults();
let store = null, timer = 0;

function merge(target, src) {
  for (const k of Object.keys(src || {})) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k] && typeof target[k] === 'object') merge(target[k], src[k]);
    else target[k] = src[k];
  }
  return target;
}

export async function loadProfile() {
  let data = null;
  try {
    if (IS_TAURI) {
      const { load } = await import('@tauri-apps/plugin-store');
      store = await load('profile.json', { defaults: {}, autoSave: false });
      data = await store.get('profile');
    } else {
      data = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!data) data = migrateLegacy();
    }
  } catch (e) { console.warn('Profile load failed, starting fresh', e); }
  if (data) merge(profile, data);
  return profile;
}

/* Picks up the record, language and display options saved by the single-page version. */
function migrateLegacy() {
  try {
    const best = JSON.parse(localStorage.getItem('last-gambit-best') || 'null');
    const lang = localStorage.getItem('last-gambit-lang');
    if (!best && !lang) return null;
    const d = defaults();
    if (best) { d.stats.bestAnte = best.ante || 0; d.stats.bestWins = best.wins || 0; }
    if (lang) d.settings.lang = lang;
    if (localStorage.getItem('last-gambit-badges') === '0') d.settings.badges = false;
    if (localStorage.getItem('last-gambit-colors') === 'classic') d.settings.colors = 'classic';
    return d;
  } catch (e) { return null; }
}

async function writeNow() {
  try {
    if (store) { await store.set('profile', profile); await store.save(); }
    else localStorage.setItem(KEY, JSON.stringify(profile));
  } catch (e) { console.warn('Profile save failed', e); }
}

export function saveProfile(immediate = false) {
  clearTimeout(timer);
  if (immediate) return writeNow();
  timer = setTimeout(writeNow, 400);
}

export function resetProfile() {
  const keepSettings = { ...profile.settings };
  const d = defaults();
  for (const k of Object.keys(profile)) delete profile[k];
  Object.assign(profile, d, { settings: keepSettings });
  return saveProfile(true);
}

export const isDesktop = IS_TAURI;
