# Progress

## Done
- Phase 1 Scaffold: Vite 6 + TS 5 strict + Vitest 3, responsive dark layout, canvas placeholder.
- Phase 2 Extraction (28 tests green, build green):
  - `vision/color` HSV mask + slider→tolerance + eyedropper (most-saturated px nearby).
  - `vision/morph` close via chamfer distance transform (disk-like; square kernel failed on diagonals).
  - `vision/components` largest 8-connected; `vision/skeleton` Zhang–Suen (active-pixel list).
  - `vision/loop` topology graph (junction clusters merged ≤10px) → 2-core spur prune →
    straight-through Euler walk (figure-eight) else longest simple cycle; open line → longest path, joined.
  - `vision/extract` pipeline; retries close radius r, 2r, 3r if loop stays open; confidence score + hints.
  - `geom/` polyline, RDP (closed), arc-length resample, centripetal Catmull–Rom, `pathFromControls`.
  - `tests/helpers/synth.ts` synthetic map: loop on noise + gap + crossing road + stray blob.

- Tuned on user's real screenshot (1600x888 phone capture, black hand-drawn line, digits 1–14
  written on it, black letterbox): ~200ms, closed loop, high confidence for tol 0.1–0.5.
  Fixes: chroma (s·v) matching for dark colours; eyedropper picks colourful-or-dark px;
  `seed` keeps the clicked component (not the letterbox); cycle score penalises sharp junction
  turns (digit loops); thick long spurs = collapsed hairpin → out-and-back excursion.
  Local harness: `tests/_local/real.test.ts` (gitignored, env REAL_RGBA/SEED_X/SEED_Y/TOL/CROP).

## Next
- Phase 3 (default tolerance slider 0.2, pass eyedropper click as `seed`): upload/drag-drop, downscale to ≤1600px, eyedropper UI, tolerance slider, overlay on dimmed
  screenshot + confidence, KML/GPX + Mercator, manual trace, editor, start line, sectors, JSON save/load.

## Open issues / env notes
- Large close radius could merge parallel straights; only used on retry when the loop is open.
- Euler walk is preferred whenever the core has all-even degrees (could include small extra loops).
- Node/Git installed via winget; refresh PATH in new shells (`Machine;User`). esbuild install script approved.
