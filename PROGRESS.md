# Progress

## Done
- Phase 1 Scaffold: Vite 6 + TS 5 (strict) + Vitest 3. `index.html` grid layout
  (topbar / stage canvas / side panel, stacks under 760px), dark broadcast CSS tokens,
  DPR-aware canvas placeholder in `src/main.ts`, `src/geom/vec2.ts` + test. Build green.

## Next
- Phase 2 Extraction: `src/vision/` mask (HSV tolerance), morphological close,
  largest component, Zhang–Suen skeleton, loop ordering (spur prune, longest cycle,
  open-end join), RDP + arc-length resample (~500) + closed Catmull–Rom.
  Synthetic test image generator in `tests/` (loop on noise, gap, crossing road).
- After Phase 2: ask user for a real screenshot to tune detection.

## Open issues / env notes
- Node 24 + Git installed via winget this session; new shells need PATH refreshed
  (`$env:Path = Machine;User`) until the app restarts.
- npm 11 blocks install scripts by default; esbuild approved via `npm install-scripts approve`.
