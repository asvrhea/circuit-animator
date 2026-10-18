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

## Next
- Tune on a real screenshot from the user (pending).
- Phase 3: upload/drag-drop, downscale to ≤1600px, eyedropper UI, tolerance slider, overlay on dimmed
  screenshot + confidence, KML/GPX + Mercator, manual trace, editor, start line, sectors, JSON save/load.

## Open issues / env notes
- Large close radius could merge parallel straights; only used on retry when the loop is open.
- Euler walk is preferred whenever the core has all-even degrees (could include small extra loops).
- Node/Git installed via winget; refresh PATH in new shells (`Machine;User`). esbuild install script approved.
