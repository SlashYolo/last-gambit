import { BASE } from './engine.js';

/* ============================== piece names ============================== */
const TNAME = {
  P: { ru: 'Пешка', en: 'Pawn' }, N: { ru: 'Конь', en: 'Knight' }, B: { ru: 'Слон', en: 'Bishop' },
  R: { ru: 'Ладья', en: 'Rook' }, Q: { ru: 'Ферзь', en: 'Queen' }, K: { ru: 'Король', en: 'King' }
};
const MVNAME = {
  R: { ru: 'По прямой на любое расстояние', en: 'Any distance in a straight line' },
  B: { ru: 'По диагонали на любое расстояние', en: 'Any distance diagonally' },
  N: { ru: 'Буквой Г (конь)', en: 'L-shaped jump (knight)' },
  K: { ru: 'На 1 клетку в любую сторону', en: 'One square in any direction' },
  W: { ru: 'Шаг: 1 клетка по прямой', en: 'Step: 1 square orthogonally' },
  F: { ru: 'Косой шаг: 1 по диагонали', en: 'Slant step: 1 square diagonally' },
  C: { ru: 'Верблюд: прыжок 3×1', en: 'Camel: 3×1 jump' },
  Z: { ru: 'Зебра: прыжок 3×2', en: 'Zebra: 3×2 jump' },
  D: { ru: 'Скачок: на 2 по прямой через фигуры', en: 'Leap: 2 squares straight, over pieces' },
  A: { ru: 'Слоновий скачок: на 2 по диагонали', en: 'Elephant leap: 2 squares diagonally' },
  P: { ru: 'Вперёд на 1 (с места на 2), бьёт по диагонали', en: 'Forward 1 (2 from start), captures diagonally' },
  Pb: { ru: 'Отступление: шаг назад', en: 'Retreat: step backwards' },
  Ps: { ru: 'Боковой шаг влево и вправо', en: 'Side step left and right' },
  Pd: { ru: 'Рывок: всегда может пойти на 2', en: 'Dash: can always move 2' },
  Pc: { ru: 'Таран: бьёт прямо вперёд', en: 'Ram: captures straight ahead' }
};
/* ============================== content ============================== */
const N2 = (ru, en) => ({ ru, en });
const UPS = {
  P: [['Pb', N2('Отступление', 'Retreat'), N2('Пешка может шагнуть назад', 'The pawn can step backwards')],
      ['Ps', N2('Боковой шаг', 'Side step'), N2('Шаг влево или вправо', 'Step left or right')],
      ['Pd', N2('Рывок', 'Dash'), N2('Всегда может пойти на 2 клетки', 'Can always move 2 squares')],
      ['Pc', N2('Таран', 'Ram'), N2('Бьёт прямо вперёд', 'Captures straight ahead')],
      ['F', N2('Косой шаг', 'Slant step'), N2('Ходит и бьёт на 1 по диагонали в любую сторону', 'Moves and captures 1 square diagonally, any direction')]],
  N: [['C', N2('Верблюд', 'Camel'), N2('Добавляет прыжок 3×1', 'Adds a 3×1 jump')],
      ['W', N2('Шаг', 'Step'), N2('Ходит на 1 клетку по прямой', 'Moves 1 square orthogonally')],
      ['Z', N2('Зебра', 'Zebra'), N2('Добавляет прыжок 3×2', 'Adds a 3×2 jump')],
      ['D', N2('Скачок', 'Leap'), N2('Прыгает на 2 клетки по прямой', 'Jumps 2 squares straight')]],
  B: [['W', N2('Шаг ладьи', 'Rook step'), N2('Ходит на 1 клетку по прямой', 'Moves 1 square orthogonally')],
      ['N', N2('Конский прыжок', 'Knight jump'), N2('Ходит ещё и конём', 'Also moves like a knight')],
      ['D', N2('Скачок', 'Leap'), N2('Прыгает на 2 клетки по прямой', 'Jumps 2 squares straight')]],
  R: [['F', N2('Косой шаг', 'Slant step'), N2('Ходит на 1 по диагонали', 'Moves 1 square diagonally')],
      ['N', N2('Конский прыжок', 'Knight jump'), N2('Ходит ещё и конём', 'Also moves like a knight')],
      ['A', N2('Слоновий скачок', 'Elephant leap'), N2('Прыгает на 2 по диагонали', 'Jumps 2 squares diagonally')]],
  Q: [['N', N2('Амазонка', 'Amazon'), N2('Ферзь ходит ещё и конём', 'The queen also moves like a knight')]],
  K: [['N', N2('Конский прыжок', 'Knight jump'), N2('Король прыгает конём', 'The king jumps like a knight')],
      ['D', N2('Скачок', 'Leap'), N2('Король прыгает на 2 по прямой', 'The king jumps 2 squares straight')],
      ['A', N2('Слоновий скачок', 'Elephant leap'), N2('Король прыгает на 2 по диагонали', 'The king jumps 2 squares diagonally')]]
};
const RELICS = {
  hourglass: { name: N2('Песочные часы', 'Hourglass'), desc: N2('+2 хода в каждой задаче', '+2 moves in every puzzle'), cost: 6 },
  crown: { name: N2('Корона мечтателя', "Dreamer's Crown"), desc: N2('Ваши пешки превращаются в ферзя уже на 7-й горизонтали', 'Your pawns promote to a queen on the 7th rank'), cost: 7 },
  grail: { name: N2('Кровавый грааль', 'Blood Grail'), desc: N2('Взятие лечит взявшую фигуру на 1 жизнь', 'A capture heals the capturing piece by 1 life'), cost: 6 },
  piggy: { name: N2('Копилка', 'Piggy Bank'), desc: N2('+$1 за каждый неиспользованный ход вместо $1 за два', '+$1 per unused move instead of $1 per two'), cost: 6 },
  coffee: { name: N2('Утренний кофе', 'Morning Coffee'), desc: N2('Первый ход в каждой задаче не тратит лимит', 'Your first move in each puzzle is free'), cost: 5 },
  aegis: { name: N2('Эгида', 'Aegis'), desc: N2('Пешки начинают каждую задачу с +1 жизнью', 'Pawns start every puzzle with +1 life'), cost: 7 },
  phoenix: { name: N2('Перо феникса', 'Phoenix Feather'), desc: N2('Один раз спасает от поражения: задача начинается заново', 'Saves you from one loss: the puzzle restarts'), cost: 8 },
  butcher: { name: N2('Мясник', 'Butcher'), desc: N2('+$2 за каждую взятую фигуру, кроме пешки', '+$2 for every captured piece except pawns'), cost: 5 },
  frost: { name: N2('Ледяное сердце', 'Frozen Heart'), desc: N2('После первого хода противника случайная его фигура замерзает на 3 хода', "After the opponent's first move, a random enemy piece freezes for 3 turns"), cost: 6 },
  gambit: { name: N2('Азарт', 'Gambit'), desc: N2('Каждый шах даёт +1 ход (до 3 за задачу)', 'Each check gives +1 move (up to 3 per puzzle)'), cost: 6 },
  prism: { name: N2('Призма', 'Prism'), desc: N2('+1 слот для расходников', '+1 consumable slot'), cost: 5 }
};
const CONS = {
  sand: { name: N2('Песок времени', 'Sands of Time'), desc: N2('+3 хода в текущей задаче', '+3 moves in the current puzzle'), cost: 3, target: null },
  ice: { name: N2('Лёд', 'Ice'), desc: N2('Заморозить вражескую фигуру на 3 хода. Замёрзшая фигура не ходит и не бьёт', 'Freeze an enemy piece for 3 turns. A frozen piece cannot move or attack'), cost: 3, target: 'enemy' },
  hammer: { name: N2('Молот', 'Hammer'), desc: N2('Разбить вражескую пешку', 'Smash an enemy pawn'), cost: 4, target: 'enemyPawn' },
  rewind: { name: N2('Перемотка', 'Rewind'), desc: N2('Отменить свой последний ход и ответ врага', 'Undo your last move and the reply'), cost: 3, target: null },
  bless: { name: N2('Благословение', 'Blessing'), desc: N2('+1 жизнь своей фигуре до конца задачи', '+1 life to one of your pieces for this puzzle'), cost: 3, target: 'own' }
};
const BOSSES = [
  { id: 'haste', name: N2('Цейтнот', 'Time Trouble'), desc: N2('Ни одного запасного хода: лимит равен длине решения', 'No spare moves: the limit equals the solution length') },
  { id: 'chains', name: N2('Оковы', 'Shackles'), desc: N2('Две ваши фигуры скованы на всю задачу: не ходят, но держат клетки', 'Two of your pieces are chained for the whole puzzle: they cannot move but still control squares') },
  { id: 'blind', name: N2('Слепая партия', 'Blindfold'), desc: N2('Подсказки ходов скрыты: ищите решение сами', 'Move hints are hidden: find the solution yourself') }
];
/* Vouchers: permanent run-wide upgrades, one offered per ante. A tier-2 voucher appears only after its tier-1 base. */
const V = (tier, req, ru, en, dru, den) => ({ tier, req, name: { ru, en }, desc: { ru: dru, en: den }, cost: 10 });
const VOUCHERS = {
  overstock: V(1, null, 'Склад', 'Overstock', 'В лавке на одно улучшение армии больше', 'One more army upgrade in the shop'),
  overstock2: V(2, 'overstock', 'Гипермаркет', 'Hypermarket', 'И ещё одно улучшение армии в лавке', 'Yet another army upgrade in the shop'),
  reroll: V(1, null, 'Оптовик', 'Wholesaler', 'Обновление лавки на $2 дешевле', 'Shop rerolls cost $2 less'),
  reroll2: V(2, 'reroll', 'Скупщик', 'Bulk Buyer', 'Обновление лавки ещё на $2 дешевле', 'Shop rerolls cost another $2 less'),
  clearance: V(1, null, 'Распродажа', 'Clearance Sale', 'Всё в лавке на 25% дешевле', 'Everything in the shop is 25% off'),
  clearance2: V(2, 'clearance', 'Ликвидация', 'Liquidation', 'Скидка в лавке вырастает до 50%', 'The shop discount grows to 50%'),
  time: V(1, null, 'Запас времени', 'Time Reserve', '+1 ход в каждой задаче', '+1 move in every puzzle'),
  time2: V(2, 'time', 'Хронометр', 'Chronometer', 'Ещё +1 ход в каждой задаче', 'Another +1 move in every puzzle'),
  seed: V(1, null, 'Посевные', 'Seed Money', 'После победы +$1 за каждые $5 в кармане, до $5', 'After a win, +$1 per $5 you hold, up to $5'),
  seed2: V(2, 'seed', 'Сбережения', 'Savings', 'Проценты после победы — до $10', 'Interest after a win goes up to $10'),
  satchel: V(1, null, 'Сумка', 'Satchel', '+1 слот для расходников', '+1 consumable slot'),
  satchel2: V(2, 'satchel', 'Рюкзак', 'Backpack', 'Ещё +1 слот для расходников', 'Another +1 consumable slot'),
  vault: V(1, null, 'Хранилище', 'Vault', '+1 слот для реликвий', '+1 relic slot'),
  vault2: V(2, 'vault', 'Сейф', 'Safe', 'Ещё +1 слот для реликвий', 'Another +1 relic slot')
};
const ARMY_START = [
  ['K', N2('Корона', 'Crown')], ['Q', N2('Гроза', 'Tempest')], ['R', N2('Бастион', 'Bastion')], ['R', N2('Цитадель', 'Citadel')],
  ['B', N2('Псалом', 'Psalm')], ['B', N2('Ладан', 'Incense')], ['N', N2('Гром', 'Thunder')], ['N', N2('Шквал', 'Squall')],
  ['P', N2('Ада', 'Ada')], ['P', N2('Бруно', 'Bruno')], ['P', N2('Вера', 'Vera')], ['P', N2('Гоша', 'Gosha')],
  ['P', N2('Дана', 'Dana')], ['P', N2('Ефим', 'Yefim')], ['P', N2('Зоя', 'Zoya')], ['P', N2('Игнат', 'Ignat')]
];

/* ---------- pixel icons ---------- */
const PAL = { k: '#14101a', y: '#f3b53c', o: '#c8702a', r: '#e8483b', R: '#8f1c2a', b: '#2f8fe0', c: '#a6e8ff', w: '#f2ead6', g: '#3fae6a', q: '#f08aa8', n: '#7a5233', s: '#e9c98a', m: '#55636f', M: '#b9c6cf', p: '#8a5cd6' };
function pixCanvas(rows) {
  const c = document.createElement('canvas'); c.width = 10; c.height = 10; const x = c.getContext('2d');
  const filled = (xx, yy) => yy >= 0 && yy < 8 && xx >= 0 && xx < 8 && rows[yy][xx] !== '.';
  x.fillStyle = '#06080b';
  for (let yy = -1; yy <= 8; yy++) for (let xx = -1; xx <= 8; xx++) {
    if (filled(xx, yy)) continue;
    if (filled(xx + 1, yy) || filled(xx - 1, yy) || filled(xx, yy + 1) || filled(xx, yy - 1)) x.fillRect(xx + 1, yy + 1, 1, 1);
  }
  rows.forEach((r, yy) => [...r].forEach((ch, xx) => { if (PAL[ch]) { x.fillStyle = PAL[ch]; x.fillRect(xx + 1, yy + 1, 1, 1); } }));
  return c;
}
const ICON_ROWS = {
  hourglass: ['yyyyyyyy', '.kwwwwk.', '..kssk..', '...kk...', '...kk...', '..kssk..', '.kssssk.', 'yyyyyyyy'],
  crown: ['........', 'y..y..y.', 'yy.y.yy.', 'yyyyyyy.', 'yryybyy.', 'yyyyyyy.', 'oooooooo', '........'],
  grail: ['rrrrrrr.', 'yrRrRry.', '.yyyyy..', '..yyy...', '...y....', '...y....', '..yyy...', '.ooooo..'],
  piggy: ['..q.....', '.qqqqq..', 'qqkqqqqq', 'qqqqqqqq', 'qqqqqqq.', '.qqqqq..', '.q...q..', '........'],
  coffee: ['..w..w..', '...w..w.', '.nnnnnn.', '.nssssnn', '.nnnnnnn', '.nnnnnn.', '..nnnn..', '.wwwwww.'],
  aegis: ['.mmmmmm.', 'mbbbbbbm', 'mbbwwbbm', 'mbwwwwbm', 'mbbwwbbm', '.mbbbbm.', '..mbbm..', '...mm...'],
  phoenix: ['......ro', '.....roy', '....roy.', '...roy..', '..roy...', '.roy....', '.oy.....', 'n.......'],
  butcher: ['MMMMMM..', 'MwwwwMm.', 'MwwwwMm.', 'MwwwwMm.', 'MMMMMMnn', '......nn', '......nn', '........'],
  frost: ['...c....', '.c.c.c..', '..ccc...', 'cccwccc.', '..ccc...', '.c.c.c..', '...c....', '........'],
  gambit: ['....yyy.', '...yyy..', '..yyy...', '.yyyyyy.', '...yyy..', '..yyy...', '.yy.....', 'y.......'],
  prism: ['...w....', '..wcw...', '..wcw...', '.wcbcw..', '.wcbcw..', 'wcbpbcw.', 'wwwwwww.', '........'],
  sand: ['bbbbbbbb', '.kssssk.', '..kssk..', '...kk...', '...kk...', '..k..k..', '.kssssk.', 'bbbbbbbb'],
  ice: ['..cccc..', '.cwwccc.', 'cwccccbc', 'cccccbbc', 'ccccbbbc', 'cccbbbbc', '.cbbbbc.', '..cccc..'],
  hammer: ['MMMMMM..', 'MwwwwM..', 'MMMMMM..', '..nn....', '..nn....', '..nn....', '..nn....', '..nn....'],
  rewind: ['........', '..g...g.', '.gg..gg.', 'ggg.ggg.', 'ggg.ggg.', '.gg..gg.', '..g...g.', '........'],
  bless: ['.rr.rr..', 'rrrrrrr.', 'rrwrrrr.', 'rwwwrrr.', 'rrwrrrr.', '.rrrrr..', '..rrr...', '...r....'],
  heart: ['........', '.rr.rr..', 'rwrrrrr.', 'rrrrrrr.', 'rrrrrrr.', '.rrrrr..', '..rrr...', '...r....'],
  snow: ['...c....', '.c.c.c..', '..ccc...', 'cccwccc.', '..ccc...', '.c.c.c..', '...c....', '........'],
  ticket: ['yyyyyyyy', 'y.yyyy.y', 'yyyyyyyy', 'yykkkkyy', 'yyyyyyyy', 'yykkyyyy', 'y.yyyy.y', 'yyyyyyyy'],
  ticket2: ['pppppppp', 'p.pppp.p', 'pppppppp', 'ppwwwwpp', 'pppppppp', 'ppwwpppp', 'p.pppp.p', 'pppppppp'],
  lock: ['..MMMM..', '.M....M.', '.M....M.', 'yyyyyyyy', 'yyykkyyy', 'yyykkyyy', 'yyyyyyyy', 'oooooooo']
};
const ICON_CANVAS = {}, ICON = {};
for (const k in ICON_ROWS) { ICON_CANVAS[k] = pixCanvas(ICON_ROWS[k]); ICON[k] = ICON_CANVAS[k].toDataURL(); }
const img = (k, cls = 'ico') => `<img class="${cls}" src="${ICON[k]}" alt="">`;


export { TNAME, MVNAME, UPS, RELICS, CONS, BOSSES, VOUCHERS, ARMY_START, ICON_CANVAS, ICON, img, pixCanvas };
