import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, valOf, legal, parsePuzzle, applyMove, searchMate, withDeadline, wMates } from '../src/engine.js';
import { generatePuzzle, genSpec } from '../src/generator.js';

const piece = (s, t) => ({ s, t, mv: BASE[t].slice(), hp: 1, mhp: 1, fz: 0, u: true, v: valOf(BASE[t]), k: Math.random() });
const targets = (b, sq) => legal(b, b[sq].s).filter(m => m.f === sq).map(m => m.t).sort((a, c) => a - c);

test('a pawn moves two squares only from its starting rank', () => {
  const b = new Array(64).fill(null);
  b[4] = piece('w', 'K'); b[60] = piece('b', 'K');
  b[8 + 0] = piece('w', 'P');      // a2: one or two squares
  b[16 + 2] = piece('w', 'P');     // c3: one square only, even with a stale "unmoved" flag
  b[48 + 7] = piece('b', 'P');     // h7: one or two squares
  b[40 + 5] = piece('b', 'P');     // f6: one square only
  assert.deepEqual(targets(b, 8), [16, 24]);
  assert.deepEqual(targets(b, 18), [26]);
  assert.deepEqual(targets(b, 55), [39, 47]);
  assert.deepEqual(targets(b, 45), [37]);
});

test('the Dash upgrade allows a double step from any rank', () => {
  const b = new Array(64).fill(null);
  b[4] = piece('w', 'K'); b[60] = piece('b', 'K');
  const p = piece('w', 'P'); p.mv.push('Pd'); b[16 + 2] = p;
  assert.deepEqual(targets(b, 18), [26, 34]);
});

test('pieces with extra lives come through the puzzle record', () => {
  const P = parsePuzzle('gen1|1500|4k3/8/8/8/8/2r5/8/4K2R|b|c3c2|h1h8|c3:2');
  assert.equal(P.board[18].hp, 2);
});

test('generated positions are forced mates of the requested length', () => {
  for (let i = 0; i < 4; i++) {
    const r = generatePuzzle(genSpec(5, 0), 8000);
    assert.ok(r, 'generator found nothing in time');
    const P = parsePuzzle(r.rec);
    assert.equal(P.n, 2);
    const b = applyMove(P.board, P.init);
    assert.ok(withDeadline(8000, () => wMates(b, P.n)), 'mate is not forced');
    assert.equal(searchMate(b, 1, 2000), null, 'mate in one is too easy');
  }
});

test('enemy modifiers come through the record: armour and an extra move', () => {
  const P = parsePuzzle('gen2|1500|4k3/8/2n5/8/8/2r5/8/4K2R|b|c3c2|h1h8|c3:2,c6:+C');
  assert.equal(P.board[18].hp, 2);
  assert.ok(P.board[42].mv.includes('C') && P.board[42].mod);
  const knightTargets = legal(P.board, 'b').filter(m => m.f === 42).map(m => m.t);
  assert.ok(knightTargets.includes(42 + 8 * 3 + 1) || knightTargets.includes(42 - 8 * 3 + 1), 'camel jump available');
});

test('generated positions from ante 3 carry enemy modifiers and stay forced', () => {
  const r = generatePuzzle(genSpec(4, 1), 12000);
  assert.ok(r, 'generator found nothing in time');
  const P = parsePuzzle(r.rec);
  assert.ok(P.board.some(p => p && p.mod), 'no modified enemy piece');
  const b = applyMove(P.board, P.init);
  assert.ok(withDeadline(10000, () => wMates(b, P.n)), 'mate is not forced');
});

test('a stalemating move counts as a one-move win for the solver', () => {
  /* Black king a8, white king c7, white queen b5: Qb6 leaves black without moves and without check. */
  const b = new Array(64).fill(null);
  b[56] = piece('b', 'K');        // a8
  b[50] = piece('w', 'K');        // c7
  b[33] = piece('w', 'Q');        // b5
  const r = searchMate(b, 1, 2000);
  assert.ok(r, 'a win in one move must be found');
  assert.equal(r.n, 1);
});

test('generated puzzles are never a one-move win for an upgraded army', async () => {
  const { oneMoveWin } = await import('../src/generator.js');
  const army = []; let id = 1;
  const add = (t, ups) => army.push({ id: id++, t, mv: [...BASE[t], ...ups.filter(c => !BASE[t].includes(c))], pw: ups.length * 2 });
  add('K', []); add('Q', ['N']); add('R', ['N']); add('R', ['F']); add('B', ['W', 'N']); add('B', []); add('N', ['C', 'Z']); add('N', []);
  for (let i = 0; i < 8; i++) add('P', i < 3 ? ['Ps'] : []);
  let made = 0;
  for (const kind of [0, 1]) {
    const r = generatePuzzle(genSpec(4, kind), 8000, army);
    if (!r) continue;
    made++;
    const P = parsePuzzle(r.rec);
    assert.ok(P.n >= 2);
    assert.equal(oneMoveWin(P, army, 3000), false);
    assert.equal(searchMate(applyMove(P.board, P.init), 1, 3000), null);
  }
  assert.ok(made > 0, 'the generator should find at least one position');
});
