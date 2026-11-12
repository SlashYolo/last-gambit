/* Background thread for the late-game position generator, so the UI never freezes while it searches.
   If the full spec takes too long it relaxes the requirements step by step. */
import { generatePuzzle, genSpec } from './generator.js';

self.onmessage = e => {
  const { id, ante, kind } = e.data;
  const base = genSpec(ante, kind);
  const attempts = [
    [base, 14000],
    [{ ...base, minN: 2, pieces: Math.max(1, base.pieces - 1) }, 6000],
    [{ ...base, minN: 2, maxN: 2, mods: Math.min(base.mods, 1) }, 6000]
  ];
  let rec = null;
  for (const [spec, ms] of attempts) { const r = generatePuzzle(spec, ms); if (r) { rec = r.rec; break; } }
  self.postMessage({ id, rec });
};
