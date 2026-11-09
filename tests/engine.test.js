import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePuzzle, legal, applyMove, hasLegal, inCheck, aiChoose, searchMate } from '../src/engine.js';
import BANK from '../data/puzzles.json' with { type: 'json' };

const find = (b, side, m) => legal(b, side).find(x => x.f === m.f && x.t === m.t);

test('puzzle bank has three non-empty tiers', () => {
  assert.equal(BANK.length, 3);
  for (const tier of BANK) assert.ok(tier.length > 200);
});

test('every main line is legal and ends in checkmate', () => {
  for (const tier of BANK) for (const rec of tier) {
    const P = parsePuzzle(rec);
    let b = applyMove(P.board, find(P.board, 'b', P.init) || P.init);
    let side = 'w';
    for (const m of P.sol) {
      const lm = find(b, side, m);
      assert.ok(lm, `illegal move in puzzle ${P.id}`);
      b = applyMove(b, lm); side = side === 'w' ? 'b' : 'w';
    }
    assert.ok(inCheck(b, 'b') && !hasLegal(b, 'b'), `puzzle ${P.id} does not end in mate`);
  }
});

test('AI answers with a legal move', () => {
  const P = parsePuzzle(BANK[1][10]);
  let b = applyMove(P.board, P.init);
  b = applyMove(b, find(b, 'w', P.sol[0]));
  const m = aiChoose(b, { ante: 1, kind: 1 }, 3);
  assert.ok(find(b, 'b', m));
});

test('solver finds a forced mate within the puzzle length', () => {
  for (let i = 0; i < BANK[0].length; i += 40) {
    const P = parsePuzzle(BANK[0][i]);
    const b = applyMove(P.board, P.init);
    const r = searchMate(b, P.n, 5000);
    assert.ok(r && r.n <= P.n, `no mate found for ${P.id}`);
  }
});
