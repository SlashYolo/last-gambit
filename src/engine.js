/* Chess rules with roguelike extensions (extra move patterns, lives, frozen and chained pieces), the AI and a forced-mate solver. */
/* ============================== chess core ============================== */
const BASE = { P: ['P'], N: ['N'], B: ['B'], R: ['R'], Q: ['R', 'B'], K: ['K'] };
const GLY = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const CV = { R: 5, B: 3.2, N: 3, K: 2, W: 1, F: 1.2, C: 2.4, Z: 2.2, D: 1, A: 1, P: 1, Pb: .3, Ps: .3, Pd: .25, Pc: .35 };
const valOf = mv => mv.reduce((s, c) => s + (CV[c] || 0), 0);
function sym(a, b) {
  const seen = new Set(), out = [];
  for (const [x, y] of [[a, b], [b, a]]) for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const k = (x * sx) + ',' + (y * sy);
    if (!seen.has(k)) { seen.add(k); out.push([x * sx, y * sy]); }
  }
  return out;
}
const LEAP = { N: sym(1, 2), C: sym(1, 3), Z: sym(2, 3), D: sym(2, 0), A: sym(2, 2), W: sym(1, 0), F: sym(1, 1) };
LEAP.K = [...LEAP.W, ...LEAP.F];
let PROMO_W = 7;

function pseudo(b, i, out) {
  const p = b[i]; if (!p || p.fz > 0 || p.ch) return;
  const x = i & 7, y = i >> 3, dir = p.s === 'w' ? 1 : -1;
  const add = (tx, ty, mode) => {
    if (tx < 0 || tx > 7 || ty < 0 || ty > 7) return false;
    const j = ty * 8 + tx, q = b[j];
    if (!q) { if (mode !== 2) out.push({ f: i, t: j, c: 0 }); return true; }
    if (q.s !== p.s && mode !== 1) out.push({ f: i, t: j, c: 1 });
    return false;
  };
  for (const m of p.mv) {
    if (m === 'R' || m === 'B') {
      for (const [dx, dy] of (m === 'R' ? LEAP.W : LEAP.F)) { let tx = x + dx, ty = y + dy; while (add(tx, ty, 0)) { tx += dx; ty += dy; } }
    } else if (LEAP[m]) {
      for (const [dx, dy] of LEAP[m]) add(x + dx, y + dy, 0);
    } else if (m === 'P') {
      /* Double step only from the pawn's own starting rank (or with the Dash upgrade). */
      if (add(x, y + dir, 1) && (y === (p.s === 'w' ? 1 : 6) || p.mv.includes('Pd'))) add(x, y + 2 * dir, 1);
      add(x - 1, y + dir, 2); add(x + 1, y + dir, 2);
    } else if (m === 'Pb') add(x, y - dir, 1);
    else if (m === 'Ps') { add(x - 1, y, 1); add(x + 1, y, 1); }
    else if (m === 'Pc') add(x, y + dir, 2);
  }
}
function clearPath(b, x, y, dx, dy) {
  const sx = Math.sign(dx), sy = Math.sign(dy); let cx = x + sx, cy = y + sy; const ex = x + dx, ey = y + dy;
  while (cx !== ex || cy !== ey) { if (b[cy * 8 + cx]) return false; cx += sx; cy += sy; }
  return true;
}
function hits(b, j, p, sq) {
  const x = j & 7, y = j >> 3, dx = (sq & 7) - x, dy = (sq >> 3) - y;
  if (!dx && !dy) return false;
  const adx = Math.abs(dx), ady = Math.abs(dy), dir = p.s === 'w' ? 1 : -1;
  for (const m of p.mv) {
    switch (m) {
      case 'R': if ((dx === 0 || dy === 0) && clearPath(b, x, y, dx, dy)) return true; break;
      case 'B': if (adx === ady && clearPath(b, x, y, dx, dy)) return true; break;
      case 'K': if (adx <= 1 && ady <= 1) return true; break;
      case 'W': if (adx + ady === 1) return true; break;
      case 'F': if (adx === 1 && ady === 1) return true; break;
      case 'N': if ((adx === 1 && ady === 2) || (adx === 2 && ady === 1)) return true; break;
      case 'C': if ((adx === 1 && ady === 3) || (adx === 3 && ady === 1)) return true; break;
      case 'Z': if ((adx === 2 && ady === 3) || (adx === 3 && ady === 2)) return true; break;
      case 'D': if ((adx === 2 && ady === 0) || (adx === 0 && ady === 2)) return true; break;
      case 'A': if (adx === 2 && ady === 2) return true; break;
      case 'P': if (adx === 1 && dy === dir) return true; break;
      case 'Pc': if (dx === 0 && dy === dir) return true; break;
    }
  }
  return false;
}
function attacked(b, sq, by) {
  for (let j = 0; j < 64; j++) { const p = b[j]; if (p && p.s === by && !(p.fz > 0) && hits(b, j, p, sq)) return true; }
  return false;
}
function kingSq(b, s) { for (let i = 0; i < 64; i++) { const p = b[i]; if (p && p.s === s && p.t === 'K') return i; } return -1; }
function applyMove(b, m, ev) {
  const nb = b.slice(); const p = { ...b[m.f] }; p.u = false; const q = b[m.t];
  if (q) {
    if (q.hp > 1) { nb[m.t] = { ...q, hp: q.hp - 1 }; nb[m.f] = p; if (ev) { ev.bounce = true; ev.hit = q; } return nb; }
    if (ev) ev.cap = q;
  }
  nb[m.f] = null;
  if (p.t === 'P') {
    const ty = m.t >> 3;
    if ((p.s === 'w' && ty >= PROMO_W) || (p.s === 'b' && ty === 0)) {
      p.t = 'Q'; p.mv = ['R', 'B', ...p.mv.filter(c => c[0] !== 'P' && c !== 'R' && c !== 'B')]; p.v = valOf(p.mv);
      if (ev) ev.promo = true;
    }
  }
  nb[m.t] = p; return nb;
}
const opp = s => s === 'w' ? 'b' : 'w';
function legal(b, side, stopAtOne) {
  const ps = [], out = [], seen = new Set();
  for (let i = 0; i < 64; i++) if (b[i] && b[i].s === side) pseudo(b, i, ps);
  const o = opp(side);
  for (const m of ps) {
    const key = m.f * 64 + m.t; if (seen.has(key)) continue; seen.add(key);
    const nb = applyMove(b, m); const k = kingSq(nb, side);
    if (k < 0 || !attacked(nb, k, o)) { out.push(m); if (stopAtOne) return out; }
  }
  return out;
}
const hasLegal = (b, s) => legal(b, s, true).length > 0;
const inCheck = (b, s) => { const k = kingSq(b, s); return k >= 0 && attacked(b, k, opp(s)); };

/* ---------- AI ---------- */
let NODES = 0; const NODE_LIMIT = 90000;
function orderMoves(moves, b) {
  for (const m of moves) m.o = m.c ? (b[m.t].v * 10 - b[m.f].v + 5) : 0;
  moves.sort((a, c) => c.o - a.o);
}
function evalB(b) {
  let s = 0, bk = -1;
  for (let i = 0; i < 64; i++) {
    const p = b[i]; if (!p) continue;
    if (p.t === 'K') { if (p.s === 'b') bk = i; continue; }
    const v = p.v * (1 + 0.45 * (p.hp - 1));
    if (p.s === 'b') { s += v; if (p.t === 'P') s += 0.12 * (6 - (i >> 3)); } else s -= v;
  }
  if (bk >= 0) {
    const x = bk & 7, y = bk >> 3; let open = 0, att = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const tx = x + dx, ty = y + dy;
      if (tx < 0 || tx > 7 || ty < 0 || ty > 7) continue;
      const q = b[ty * 8 + tx]; if (q && q.s === 'b') continue;
      open++; if (attacked(b, ty * 8 + tx, 'w')) att++;
    }
    s += 0.06 * open - 0.22 * att;
    if (attacked(b, bk, 'w')) s -= 0.6;
  }
  return s;
}
function onlyKing(b, s) { for (let i = 0; i < 64; i++) { const p = b[i]; if (p && p.s === s && p.t !== 'K') return false; } return true; }
function search(b, depth, alpha, beta, side, ml) {
  NODES++;
  if (depth === 0 || NODES > NODE_LIMIT) {
    if (side === 'b') { if ((inCheck(b, 'b') || onlyKing(b, 'b')) && !hasLegal(b, 'b')) return -100000; }
    else if (inCheck(b, 'w') && !hasLegal(b, 'w')) return 100000;
    return evalB(b);
  }
  const moves = legal(b, side);
  if (!moves.length) return side === 'b' ? -100000 - depth : 100000 + depth;
  orderMoves(moves, b);
  if (side === 'b') {
    let best = -1e9;
    for (const m of moves) {
      const s = search(applyMove(b, m), depth - 1, alpha, beta, 'w', ml);
      if (s > best) best = s; if (best > alpha) alpha = best; if (alpha >= beta) break;
    }
    return best;
  }
  let best = 1e9;
  for (const m of moves) {
    const nb = applyMove(b, m); let s;
    if (ml - 1 <= 0) s = hasLegal(nb, 'b') ? 90000 : -100000;
    else s = search(nb, depth - 1, alpha, beta, 'b', ml - 1);
    if (s < best) best = s; if (best < beta) beta = best; if (alpha >= beta) break;
  }
  return best;
}
function aiChoose(b, enc, movesLeft) {
  const moves = legal(b, 'b'); if (!moves.length) return null;
  const total = b.reduce((n, p) => n + (p ? 1 : 0), 0);
  const depth = total <= 10 ? 4 : 3;
  const jit = 0.2;
  NODES = 0; orderMoves(moves, b);
  let best = -Infinity, bm = moves[0];
  for (const m of moves) {
    const s = search(applyMove(b, m), depth - 1, best === -Infinity ? -1e9 : best - jit, 1e9, 'w', movesLeft) + Math.random() * jit;
    if (s > best) { best = s; bm = m; }
  }
  return bm;
}

/* ============================== puzzle bank ============================== */
/* Puzzle record: id|rating|board FEN|side to move|opponent's first move|solution (UCI). */
const sqIx = (u, flip) => { const x = u.charCodeAt(0) - 97, y = +u[1] - 1; return (flip ? 7 - y : y) * 8 + x; };
const sqName = i => 'abcdefgh'[i & 7] + ((i >> 3) + 1);
function parsePuzzle(rec) {
  const [id, rating, fenBoard, stm, init, sol, lives] = rec.split('|');
  const flip = stm === 'w';
  const b = new Array(64).fill(null); let k = 1;
  fenBoard.split('/').forEach((row, ri) => {
    let x = 0; const y0 = 7 - ri;
    for (const ch of row) {
      if (/\d/.test(ch)) { x += +ch; continue; }
      const tp = ch.toUpperCase();
      let s = ch === tp ? 'w' : 'b', y = y0;
      if (flip) { s = opp(s); y = 7 - y0; }
      const mv = BASE[tp].slice();
      b[y * 8 + x] = { s, t: tp, mv, hp: 1, mhp: 1, fz: 0, u: tp === 'P' && ((s === 'w' && y === 1) || (s === 'b' && y === 6)), v: valOf(mv), k: k++ };
      x++;
    }
  });
  /* Optional 7th field: squares of pieces with extra lives, e.g. "e7:2,c6:2" (used by generated positions). */
  if (lives) for (const it of lives.split(',')) { const [sq, n] = it.split(':'); const i = sqIx(sq, flip); if (b[i]) b[i] = { ...b[i], hp: +n, mhp: +n }; }
  const mv = u => ({ f: sqIx(u.slice(0, 2), flip), t: sqIx(u.slice(2, 4), flip) });
  const line = sol.split(' ');
  const P = { id, rating: +rating, board: b, init: mv(init), sol: line.map(mv), n: Math.ceil(line.length / 2) };
  const org = b.map((p, i) => p ? i : -1); P.movers = new Set();
  const step = (m, white) => { const o = org[m.f]; if (white && o >= 0) P.movers.add(o); org[m.t] = o; org[m.f] = -1; };
  step(P.init, false); P.sol.forEach((m, i) => step(m, i % 2 === 0));
  return P;
}


/* ---------- forced-mate solver ---------- */
let SDL = 0, SABORT = false;
function withDeadline(ms, fn) { SDL = performance.now() + ms; SABORT = false; const r = fn(); return SABORT ? undefined : r; }
function wMates(b, k) {
  if (performance.now() > SDL) { SABORT = true; return null; }
  const list = legal(b, 'w').map(m => { const nb = applyMove(b, m); return { m, nb, chk: inCheck(nb, 'b') }; });
  list.sort((x, y) => (y.chk - x.chk) || (y.m.c - x.m.c));
  for (const s of list) {
    if (k === 1 && !s.chk) continue;
    if (!hasLegal(s.nb, 'b')) return s.m;
    if (k > 1 && bLoses(s.nb, k - 1)) return s.m;
    if (SABORT) return null;
  }
  return null;
}
function bLoses(b, k) {
  for (const m of legal(b, 'b')) { if (!wMates(applyMove(b, m), k)) return false; if (SABORT) return false; }
  return true;
}
/* Shortest forced win (mate or stalemate) for white within maxK moves, or null. */
function searchMate(b, maxK, ms) {
  SDL = performance.now() + ms; SABORT = false;
  for (let k = 1; k <= maxK && !SABORT; k++) { const m = wMates(b, k); if (m && !SABORT) return { m, n: k }; }
  return null;
}
function attackersOf(b, sq, by) { let n = 0; for (let j = 0; j < 64; j++) { const p = b[j]; if (p && p.s === by && !(p.fz > 0) && hits(b, j, p, sq)) n++; } return n; }
function kingRing(b, k) { const out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const x = (k & 7) + dx, y = (k >> 3) + dy; if (x >= 0 && x < 8 && y >= 0 && y < 8) out.push(y * 8 + x); } return out; }
function mateTheme(nb, m) {
  const k = kingSq(nb, 'b'), mv = nb[m.t];
  if (attackersOf(nb, k, 'w') >= 2) return 'th_double';
  if (mv.t === 'N' && kingRing(nb, k).every(i => nb[i] && nb[i].s === 'b')) return 'th_smother';
  if ((k >> 3) === 7 && (m.t >> 3) === 7 && (mv.t === 'R' || mv.t === 'Q')) return 'th_backrank';
  return null;
}
function setPromoRank(r) { PROMO_W = r; }

export {
  BASE, GLY, CV, valOf, LEAP, pseudo, hits, attacked, kingSq, applyMove, opp, legal, hasLegal, inCheck,
  evalB, aiChoose, sqName, parsePuzzle, setPromoRank,
  withDeadline, wMates, bLoses, searchMate, attackersOf, kingRing, mateTheme
};
