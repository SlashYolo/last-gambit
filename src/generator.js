/* Random mate positions for the late game (ante 5 and later).
   A position is accepted only when the forced-mate solver proves that white mates in exactly n moves
   against every defence, so every generated puzzle is solvable. The result uses the same record
   format as the Lichess bank: id|rating|FEN board|side to move|opponent's first move|solution|lives. */
import { BASE, valOf, legal, applyMove, hasLegal, inCheck, sqName, searchMate } from './engine.js';

const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const KITS = [['Q', 'R'], ['Q', 'N'], ['R', 'R'], ['R', 'B'], ['Q', 'B'], ['R', 'N', 'B'], ['Q'], ['R', 'N'], ['Q', 'R', 'N'], ['B', 'B', 'R'], ['N', 'N', 'R']];

/* Difficulty by ante and encounter kind: mate length, defenders, extra lives. */
export function genSpec(ante, kind) {
  const a = Math.max(0, ante - 5);
  return {
    minN: kind === 2 ? 3 : 2,
    maxN: kind === 0 ? 2 : 3,
    pieces: Math.min(5, 1 + kind + Math.floor(a / 2)),
    pawns: Math.min(5, 2 + Math.floor(a / 3)),
    lives: ante >= 7 ? Math.min(3, 1 + Math.floor((ante - 7) / 2)) : 0,
    ante, kind
  };
}

function piece(s, t, k) { const mv = BASE[t].slice(); return { s, t, mv, hp: 1, mhp: 1, fz: 0, u: false, v: valOf(mv), k }; }

function randomBoard(spec) {
  const b = new Array(64).fill(null); let k = 1;
  const free = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8 && !b[y * 8 + x];
  const put = (s, t, x, y) => { if (!free(x, y)) return false; if (t === 'P' && (y === 0 || y === 7)) return false; b[y * 8 + x] = piece(s, t, k++); return true; };
  const kx = rnd(8), ky = Math.random() < .7 ? 7 : 6;
  put('b', 'K', kx, ky);
  for (let i = 0, tries = 0; i < spec.pawns && tries < 30; tries++) {
    const x = kx + rnd(3) - 1, y = Math.random() < .7 ? ky - 1 : 4 + rnd(3);
    if (put('b', 'P', x, y)) i++;
  }
  const defs = ['R', 'B', 'N', 'R', 'B', 'N', ...(spec.ante >= 7 ? ['Q'] : [])];
  for (let i = 0, tries = 0; i < spec.pieces && tries < 40; tries++) if (put('b', pick(defs), rnd(8), 3 + rnd(5))) i++;
  for (let tries = 0; tries < 20; tries++) if (put('w', 'K', rnd(8), rnd(2))) break;
  for (const t of pick(KITS)) for (let tries = 0; tries < 30; tries++) if (put('w', t, rnd(8), 1 + rnd(7))) break;
  for (let i = 0, n = rnd(4), tries = 0; i < n && tries < 20; tries++) if (put('w', 'P', rnd(8), 1 + rnd(4))) i++;
  if (spec.lives) {
    const cand = b.map((p, i) => p && p.s === 'b' && p.t !== 'K' && p.t !== 'P' ? i : -1).filter(i => i >= 0);
    for (let i = 0; i < spec.lives && cand.length; i++) { const j = cand.splice(rnd(cand.length), 1)[0]; b[j] = { ...b[j], hp: 2, mhp: 2 }; }
  }
  return b;
}

function fenOf(b) {
  const rows = [];
  for (let y = 7; y >= 0; y--) {
    let row = '', gap = 0;
    for (let x = 0; x < 8; x++) {
      const p = b[y * 8 + x];
      if (!p) { gap++; continue; }
      if (gap) { row += gap; gap = 0; }
      row += p.s === 'w' ? p.t : p.t.toLowerCase();
    }
    rows.push(row + (gap || ''));
  }
  return rows.join('/');
}
const uci = m => sqName(m.f) + sqName(m.t);

/* The solution line: white's shortest mate, black's most stubborn reply, and so on. */
function mainLine(b, n, deadline) {
  const line = [];
  for (let left = n; left > 0; left--) {
    const r = searchMate(b, left, Math.max(50, deadline - performance.now()));
    if (!r) return null;
    line.push(r.m); b = applyMove(b, r.m);
    const replies = legal(b, 'b');
    if (!replies.length) return line;
    let best = null, bestN = -1;
    for (const m of replies) {
      const nb = applyMove(b, m);
      const rr = searchMate(nb, left - 1, Math.max(50, deadline - performance.now()));
      if (!rr) return null;
      if (rr.n > bestN || (rr.n === bestN && Math.random() < .5)) { bestN = rr.n; best = m; }
    }
    line.push(best); b = applyMove(b, best);
  }
  return line;
}

/* Tries random positions until one passes or the time budget runs out. */
export function generatePuzzle(spec, budgetMs = 4000) {
  const end = performance.now() + budgetMs;
  let tries = 0;
  while (performance.now() < end) {
    tries++;
    const b0 = randomBoard(spec);
    if (inCheck(b0, 'w') || inCheck(b0, 'b')) continue;
    const opening = legal(b0, 'b').filter(m => b0[m.f].t !== 'K' && !b0[m.t]);
    if (opening.length < 3) continue;
    const init = pick(opening);
    const b1 = applyMove(b0, init);
    if (!hasLegal(b1, 'w') || inCheck(b1, 'w')) continue;
    const r = searchMate(b1, spec.maxN, Math.min(400, end - performance.now()));
    if (!r || r.n < spec.minN) continue;
    const line = mainLine(b1, r.n, Math.min(end, performance.now() + 1500));
    if (!line || line.length !== 2 * r.n - 1) continue;
    const lives = b0.map((p, i) => p && p.hp > 1 ? `${sqName(i)}:${p.hp}` : null).filter(Boolean).join(',');
    const defenders = b0.filter(p => p && p.s === 'b' && p.t !== 'K').length;
    const rating = Math.min(2600, 1300 + 250 * (r.n - 1) + 40 * defenders + 60 * (spec.ante - 5) + 120 * (lives ? lives.split(',').length : 0));
    const id = 'gen' + Date.now().toString(36) + rnd(1e6).toString(36);
    return { rec: [id, rating, fenOf(b0), 'b', uci(init), line.map(uci).join(' '), lives].join('|'), tries, n: r.n };
  }
  return null;
}
