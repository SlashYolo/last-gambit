/* Splash screen, main menu and the progress / achievements / settings screens.
   game.js passes its UI helpers in through initMeta() so this module stays free of import cycles. */
import { t, L, LANG } from './i18n.js';
import { profile, saveProfile, resetProfile, isDesktop } from './storage.js';
import { ACHIEVEMENTS, unlockedCount, achName, achDesc, setAchievementNotifier } from './achievements.js';

let api = null;
export function initMeta(a) {
  api = a;
  setAchievementNotifier(showAchievementPopup);
}

/* ---------- splash ---------- */
export function showSplash() {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.id = 'splash';
    const word = (w, cls) => `<div class="sp-word ${cls}">${[...w].map((ch, i) => `<span style="animation-delay:${(i * 0.05 + (cls === 'two' ? .45 : 0)).toFixed(2)}s">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</div>`;
    el.innerHTML = `
      <div class="sp-inner">
        <div class="sp-knight" aria-hidden="true">${api.gl('N', 'w')}</div>
        ${word(t('title_1'), 'one')}${word(t('title_2'), 'two')}
        <div class="sp-tag">${t('splash_tag')}</div>
        <div class="sp-press">${t('splash_press')}</div>
      </div>`;
    document.body.appendChild(el);
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      removeEventListener('keydown', finish); el.removeEventListener('pointerdown', finish);
      el.classList.add('out'); api.sfx('magic');
      setTimeout(() => { el.remove(); resolve(); }, 450);
    };
    setTimeout(() => { addEventListener('keydown', finish); el.addEventListener('pointerdown', finish); }, 350);
    setTimeout(finish, 4200);
  });
}

/* ---------- main menu ---------- */
let confirmNewUntil = 0;
export function showMenu() {
  api.enterMenu();
  api.setRerender(renderMenu);
  renderMenu();
}
function renderMenu() {
  const s = profile.stats, run = profile.run;
  const progress = s.solved || s.bestAnte
    ? t('m_progress', { a: s.bestAnte, w: s.bestWins, s: s.solved, n: unlockedCount(), N: ACHIEVEMENTS.length })
    : t('m_progress_new');
  const contSub = run ? (run.training ? t('m_continue_train', { a: Math.floor(run.encIndex / 3) + 1 }) : t('m_continue_sub', { a: Math.floor(run.encIndex / 3) + 1, w: run.wins, g: run.gold })) : '';
  const confirming = Date.now() < confirmNewUntil;
  api.showOverlay(`
    <div class="menu">
      <div class="title"><div class="title-word">${t('title_1')}</div><div class="title-word two">${t('title_2')}</div></div>
      <div class="menu-grid">
        <nav class="menu-btns" aria-label="${t('m_menu')}">
          ${run ? `<button class="btn gold menu-btn" data-act="continue" type="button">${t('m_continue')}<small>${contSub}</small></button>` : ''}
          <button class="btn red menu-btn" data-act="m-new" type="button">${t('m_new')}${confirming ? `<small>${t('m_confirm_new')}</small>` : ''}</button>
          <button class="btn violet menu-btn" data-act="m-train" type="button">${t('m_train')}</button>
          <div class="menu-row">
            <button class="btn ghost" data-act="m-how" type="button">${t('m_how')}</button>
            <button class="btn ghost" data-act="m-ach" type="button">${t('m_ach')} <span class="pill">${unlockedCount()}/${ACHIEVEMENTS.length}</span></button>
          </div>
          <div class="menu-row">
            <button class="btn ghost" data-act="m-stats" type="button">${t('m_stats')}</button>
            <button class="btn ghost" data-act="m-settings" type="button">${t('m_settings')}</button>
          </div>
          <div class="menu-row">
            <button class="btn ghost" data-act="lang" type="button">${t('lang_other')}</button>
            ${isDesktop ? `<button class="btn ghost" data-act="m-quit" type="button">${t('m_quit')}</button>` : ''}
          </div>
        </nav>
      </div>
      <p class="menu-progress">${progress}</p>
      <p class="credit">${t('credit')}</p>
    </div>`);
}
function startNew(training) {
  if (profile.run && Date.now() > confirmNewUntil) { confirmNewUntil = Date.now() + 4000; renderMenu(); setTimeout(() => { if (api.isMenu()) renderMenu(); }, 4100); return; }
  confirmNewUntil = 0;
  api.newRun(training);
}

/* ---------- how to play ---------- */
function showHow() {
  api.setRerender(showHow);
  api.showOverlay(`
    <div class="scr-head"><h2>${t('m_how')}</h2></div>
    <div class="rules"><ol>${t('rules').map(r => `<li>${r}</li>`).join('')}</ol><p class="muted">${t('train_note')}</p><p class="muted">${t('m_saved_note')}</p></div>
    <div class="row-btns"><button class="btn ghost" data-act="m-back" type="button">${t('m_back')}</button></div>`);
}

/* ---------- achievements ---------- */
function showAchievements() {
  api.setRerender(showAchievements);
  const fmt = ts => new Date(ts).toLocaleDateString(LANG === 'ru' ? 'ru-RU' : 'en-GB');
  const cards = ACHIEVEMENTS.map(a => {
    const got = profile.ach[a.id];
    return `<div class="ach${got ? ' got' : ''}">
      <div class="ach-ico">${achIcon(a)}</div>
      <div class="ach-txt"><b>${api.esc(achName(a))}</b><span>${api.esc(achDesc(a))}</span>
      <small>${got ? fmt(got) : t('ach_locked')}</small></div></div>`;
  }).join('');
  api.showOverlay(`
    <div class="scr-head"><h2>${t('ach_title')}</h2><div class="eyebrow">${t('ach_count', { n: unlockedCount(), N: ACHIEVEMENTS.length })}</div></div>
    <div class="ach-grid">${cards}</div>
    <div class="row-btns"><button class="btn ghost" data-act="m-back" type="button">${t('m_back')}</button></div>`);
}
function achIcon(a) { return a.icon.length === 1 ? api.gl(a.icon, 'w') : api.img(a.icon, ''); }

/* ---------- statistics ---------- */
function showStats() {
  api.setRerender(showStats);
  const s = profile.stats;
  const h = Math.floor(s.playSeconds / 3600), m = Math.floor((s.playSeconds % 3600) / 60);
  const rows = [
    ['st_runs', s.runs], ['st_best_ante', s.bestAnte], ['st_best_wins', s.bestWins], ['st_solved', s.solved],
    ['st_mates', s.mates], ['st_stales', s.stalemates], ['st_exact', s.exact], ['st_bosses', s.bosses],
    ['st_gold', '$' + s.goldEarned], ['st_promos', s.promotions], ['st_train', s.trainingSolved], ['st_hints', s.hints],
    ['st_time', t('st_time_v', { h, m })]
  ];
  api.showOverlay(`
    <div class="scr-head"><h2>${t('st_title')}</h2></div>
    <div class="tally stats">${rows.map(([k, v]) => `<div style="animation:none;opacity:1"><span>${t(k)}</span><b>${v}</b></div>`).join('')}</div>
    <p class="sub small">${t('st_note')}</p>
    <div class="row-btns"><button class="btn ghost" data-act="m-back" type="button">${t('m_back')}</button></div>`);
}

/* ---------- settings ---------- */
let resetArmed = 0;
function showSettings() {
  api.setRerender(showSettings);
  const st = profile.settings;
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, label]) => `<button type="button" class="seg-b${String(st[key]) === String(v) ? ' on' : ''}" data-set="${key}" data-val="${v}" aria-pressed="${String(st[key]) === String(v)}">${label}</button>`).join('')}</div>`;
  const onoff = key => seg(key, [[true, t('on')], [false, t('off')]]);
  api.showOverlay(`
    <div class="scr-head"><h2>${t('set_title')}</h2></div>
    <div class="settings">
      <div class="set-row"><span>${t('set_lang')}</span>${seg('lang', [['ru', 'Русский'], ['en', 'English']])}</div>
      <div class="set-row"><span>${t('set_sound')}</span>${onoff('sound')}</div>
      <div class="set-row"><label for="setVol">${t('set_volume')}</label><input id="setVol" type="range" min="0" max="100" step="5" value="${Math.round(st.volume * 100)}"></div>
      <div class="set-row"><span>${t('set_colors')}</span>${seg('colors', [['type', t('set_colors_type')], ['classic', t('set_colors_classic')]])}</div>
      <div class="set-row"><span>${t('set_badges')}</span>${onoff('badges')}</div>
      <div class="set-row"><span>${t('set_crt')}<small>${t('set_crt_note')}</small></span>${onoff('crt')}</div>
      <div class="set-row"><span>${t('set_full')}</span>${onoff('fullscreen')}</div>
      <div class="set-row"><span></span><button class="btn red small" type="button" data-act="m-reset">${Date.now() - resetArmed < 3000 ? t('set_reset_sure') : t('set_reset')}</button></div>
    </div>
    <div class="row-btns"><button class="btn ghost" data-act="m-back" type="button">${t('m_back')}</button></div>`);
  const vol = document.getElementById('setVol');
  vol.addEventListener('input', () => { st.volume = vol.value / 100; api.applySettings(); saveProfile(); });
  vol.addEventListener('change', () => api.sfx('coin'));
}
function setSetting(key, raw) {
  const st = profile.settings;
  const val = raw === 'true' ? true : raw === 'false' ? false : raw;
  st[key] = val; saveProfile(); api.applySettings(key);
  if (api.isMenuScreen()) api.rerender();
}

/* ---------- achievement popup ---------- */
const queue = []; let showing = false;
function showAchievementPopup(a) { queue.push(a); if (!showing) nextPopup(); }
function nextPopup() {
  const a = queue.shift(); if (!a) { showing = false; return; }
  showing = true;
  const el = document.createElement('div'); el.className = 'ach-pop'; el.setAttribute('role', 'status');
  el.innerHTML = `<div class="ach-ico">${achIcon(a)}</div><div><div class="eyebrow">${t('ach_unlocked')}</div><b>${api.esc(achName(a))}</b><span>${api.esc(achDesc(a))}</span></div>`;
  document.body.appendChild(el); api.sfx('magic');
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => { el.remove(); nextPopup(); }, 3650);
}

/* ---------- clicks on meta screens ---------- */
document.addEventListener('click', e => {
  const s = e.target.closest('[data-set]');
  if (s) { setSetting(s.dataset.set, s.dataset.val); api.sfx('select'); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  switch (a.dataset.act) {
    case 'continue': api.continueRun(); break;
    case 'm-new': startNew(false); break;
    case 'm-train': startNew(true); break;
    case 'm-how': showHow(); break;
    case 'm-ach': showAchievements(); break;
    case 'm-stats': showStats(); break;
    case 'm-settings': showSettings(); break;
    case 'm-back': showMenu(); break;
    case 'm-quit': api.quit(); break;
    case 'm-reset':
      if (Date.now() - resetArmed < 3000) { resetArmed = 0; resetProfile().then(() => { api.toast(t('set_reset_done')); showSettings(); }); }
      else { resetArmed = Date.now(); showSettings(); setTimeout(() => { if (api.isMenuScreen()) api.rerender(); }, 3100); }
      break;
    default: return;
  }
  api.sfx('select');
});
