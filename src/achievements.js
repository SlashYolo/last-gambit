/* Achievements and lifetime statistics. The game reports events with track(); runs in training mode
   only count toward the training achievements and the training statistics. */
import { profile, saveProfile } from './storage.js';
import { t, L } from './i18n.js';

const A = (id, icon, ru, en, dru, den, extra = {}) => ({ id, icon, name: { ru, en }, desc: { ru: dru, en: den }, ...extra });
export const ACHIEVEMENTS = [
  A('first_win', 'P', 'Первый мат', 'First Mate', 'Решите первую задачу в забеге', 'Solve your first puzzle in a run'),
  A('boss', 'K', 'Голова босса', 'Boss Slayer', 'Победите босса', 'Defeat a boss'),
  A('ante3', 'hourglass', 'Середина партии', 'Middlegame', 'Дойдите до анте 3', 'Reach ante 3'),
  A('ante5', 'crown', 'Эндшпиль', 'Endgame', 'Дойдите до анте 5', 'Reach ante 5'),
  A('ante8', 'gambit', 'Последний гамбит', 'The Last Gambit', 'Дойдите до анте 8', 'Reach ante 8'),
  A('mate_knight', 'N', 'Конь-огонь', 'Horsepower', 'Поставьте мат конём', 'Deliver mate with a knight'),
  A('mate_pawn', 'P', 'Пешечный приговор', 'Pawn Verdict', 'Поставьте мат пешкой', 'Deliver mate with a pawn'),
  A('mate_king', 'K', 'Король сам', 'The King Himself', 'Поставьте мат королём', 'Deliver mate with your king'),
  A('stalemate', 'snow', 'Пат — тоже победа', 'Stalemate Counts', 'Выиграйте задачу патом', 'Win a puzzle by stalemate'),
  A('exact', 'butcher', 'Точный расчёт', 'Precise', 'Решите задачу без лишних ходов', 'Solve a puzzle with no extra moves'),
  A('sniper', 'gambit', 'Снайпер', 'Sniper', 'Наберите 10 точных решений', 'Collect 10 exact solutions'),
  A('smother', 'N', 'Спёртый мат', 'Smothered', 'Поставьте спёртый мат', 'Deliver a smothered mate'),
  A('backrank', 'R', 'Задняя горизонталь', 'Back Rank', 'Поставьте мат по последней горизонтали', 'Deliver a back-rank mate'),
  A('double', 'Q', 'Двойной удар', 'Double Trouble', 'Поставьте мат двойным шахом', 'Deliver mate with a double check'),
  A('promo', 'Q', 'Новая королева', 'A New Queen', 'Превратите пешку в ферзя', 'Promote a pawn to a queen'),
  A('rich', 'piggy', 'Казна', 'Treasury', 'Накопите $30 за один забег', 'Hold $30 at once in a run'),
  A('collector', 'prism', 'Коллекционер', 'Collector', 'Соберите 5 реликвий за один забег', 'Own 5 relics in one run'),
  A('smith', 'hammer', 'Кузнец', 'Blacksmith', 'Купите 5 улучшений фигур за один забег', 'Buy 5 piece upgrades in one run'),
  A('last_breath', 'sand', 'На последнем дыхании', 'Last Breath', 'Поставьте мат последним доступным ходом', 'Deliver mate with your very last move'),
  A('blindfold', 'B', 'Вслепую', 'Blindfolded', 'Победите босса «Слепая партия»', 'Defeat the Blindfold boss'),
  A('voucher', 'ticket', 'Купонщик', 'Coupon Clipper', 'Купите ваучер', 'Buy a voucher'),
  A('merchant', 'piggy', 'Барахолка', 'Flea Market', 'Продайте реликвию', 'Sell a relic'),
  A('generated', 'prism', 'Новая территория', 'Uncharted', 'Решите случайную позицию (с анте 3)', 'Solve a random position (ante 3 and later)'),
  A('phoenix', 'phoenix', 'Из пепла', 'From the Ashes', 'Спаситесь пером феникса', 'Get saved by the phoenix feather'),
  A('solver50', 'bless', 'Решатель', 'Solver', 'Решите 50 задач в забегах', 'Solve 50 puzzles in runs'),
  A('solver200', 'crown', 'Задачник', 'Problemist', 'Решите 200 задач в забегах', 'Solve 200 puzzles in runs'),
  A('student', 'aegis', 'Ученик', 'Student', 'Решите 10 задач в обучении', 'Solve 10 puzzles in training', { training: true }),
  A('self_taught', 'coffee', 'Сам с усами', 'Self-Taught', 'Решите тяжёлую задачу в обучении без подсказок', 'Solve a hard puzzle in training without hints', { training: true })
];
const BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

let notify = () => {};
export function setAchievementNotifier(fn) { notify = fn; }
export const unlockedCount = () => ACHIEVEMENTS.filter(a => profile.ach[a.id]).length;
export const achName = a => L(a.name);
export const achDesc = a => L(a.desc);

function unlock(id) {
  if (profile.ach[id] || !BY_ID[id]) return;
  profile.ach[id] = Date.now();
  saveProfile();
  notify(BY_ID[id]);
}

/* Events: runStart, win, ante, promo, gold, relics, upgrades, sell, voucher, phoenix, hint, playtime. */
export function track(ev, d = {}) {
  const s = profile.stats, tr = !!d.training;
  switch (ev) {
    case 'runStart': if (!tr) s.runs++; break;
    case 'win':
      if (tr) {
        s.trainingSolved++;
        if (s.trainingSolved >= 10) unlock('student');
        if (d.kind === 2 && !d.hintsUsed) unlock('self_taught');
        break;
      }
      s.solved++; s.goldEarned += d.gold || 0;
      if (d.result === 'mate') s.mates++; else s.stalemates++;
      if (d.exact) s.exact++;
      if (d.kind === 2) s.bosses++;
      s.bestWins = Math.max(s.bestWins, d.wins || 0);
      unlock('first_win');
      if (d.kind === 2) unlock('boss');
      if (d.boss === 'blind') unlock('blindfold');
      if (d.result === 'stalemate') unlock('stalemate');
      if (d.result === 'mate') {
        if (d.mater === 'N') unlock('mate_knight');
        if (d.mater === 'P') unlock('mate_pawn');
        if (d.mater === 'K') unlock('mate_king');
        if (d.theme === 'th_smother') unlock('smother');
        if (d.theme === 'th_backrank') unlock('backrank');
        if (d.theme === 'th_double') unlock('double');
      }
      if (d.exact) unlock('exact');
      if (s.exact >= 10) unlock('sniper');
      if (d.lastMove) unlock('last_breath');
      if (d.generated) unlock('generated');
      if (s.solved >= 50) unlock('solver50');
      if (s.solved >= 200) unlock('solver200');
      break;
    case 'ante':
      if (tr) break;
      s.bestAnte = Math.max(s.bestAnte, d.ante);
      if (d.ante >= 3) unlock('ante3');
      if (d.ante >= 5) unlock('ante5');
      if (d.ante >= 8) unlock('ante8');
      break;
    case 'promo': if (!tr) { s.promotions++; unlock('promo'); } break;
    case 'gold': if (!tr && d.gold >= 30) unlock('rich'); break;
    case 'relics': if (!tr && d.count >= 5) unlock('collector'); break;
    case 'upgrades': if (!tr && d.count >= 5) unlock('smith'); break;
    case 'phoenix': if (!tr) unlock('phoenix'); break;
    case 'sell': if (!tr) unlock('merchant'); break;
    case 'voucher': if (!tr) unlock('voucher'); break;
    case 'hint': s.hints++; break;
    case 'playtime': s.playSeconds += d.seconds || 0; break;
  }
  saveProfile();
}

export function achievementCountLabel() { return t('ach_count', { n: unlockedCount(), N: ACHIEVEMENTS.length }); }
