# Progress

## Done
- Phase 1 Scaffold: Vite 6 + TS 5 strict + Vitest 3, responsive dark broadcast layout.
- Phase 2 Extraction: `vision/` (chroma-HSV mask, chamfer close, seeded component, Zhang–Suen,
  graph loop ordering w/ spur prune, turn-penalised longest cycle, figure-eight Euler walk,
  collapsed-hairpin recovery, close-radius retry, confidence) + `geom/` RDP/resample/Catmull–Rom.
  Tuned on user's real phone screenshot (black hand-drawn line + digits): ~200ms, high confidence.
- Phase 3 Inputs + editor (52 tests, build green, verified in browser pane):
  - `geom/projection` Web Mercator + haversine; `io/geo` regex KML/GPX parse → fitted controls (RDP 2px,
    ≤120 pts) + real km; `io/trackFile` TrackDoc v1 JSON (validate/repair); `geom/edit` pure ops.
  - `render/view` (fit/zoom/pan), `render/editor` (dimmed image, sector colours, chequered start,
    direction chevron, S2/S3 ticks, controls, trace), `render/theme`.
  - `ui/app` modes edit/pick/trace/start/split0/split1; drag, tap-line insert, right-click/long-press
    delete, wheel/pinch zoom, drag-pan, undo (Ctrl+Z, 60 deep), Esc; drop/open PNG/JPG/KML/GPX/JSON;
    image downscaled ≤1600; autosave doc + JPEG image to localStorage (try/catch); restore on load.
  - TrackDoc model: controls[0] = start/finish, order = direction, sectors as lap fractions.

## Next
- Phase 4 Animation: `sim/` curvature, speed profile (v=min(vMax, sqrt(aLat/κ)) + fwd/back passes),
  lap timing; `render/` car + trail, draw-in intro, HUD (timer, sectors, km/h from lengthKm),
  cameras (full / follow), themes (broadcast / over screenshot), play/pause/scrub/speed/laps.

## Open issues / env notes
- Start/finish after detection is arbitrary (where the loop trace began); user sets it + Reverse.
- Large close radius could merge parallel straights (only used on retry when loop stays open).
- `img.decode()` stalls in background tabs: use onload. Local harness `tests/_local/` (gitignored).
- Dev server for browser pane: `.claude/launch.json` ("dev", node + vite.js, port 5173).
- Node/Git installed via winget; refresh PATH in new shells. esbuild install script approved.
