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

- Phase 4 Animation (67 tests, verified in browser on the real track):
  - `sim/curvature` Menger κ (k=2) + smoothing; `sim/speed` corner limit, forward/backward passes from
    slowest corner (exact for closed loop), friction circle + drag fade; presets Formula/GT/Road car;
    standing-start lap 1. `sim/lap` time integration (const accel per segment), sampleAtTime/timeAtDist,
    sector times. `sim/race` timeline intro 3s → laps → outro 4s cool-down; raceState(t) pure.
  - `render/camera` rotate+zoom with exp smoothing; `render/anim` grid/screenshot bg, draw-in reveal,
    sector-lit track, chequered line, time-based fading trail, car chevron, minimap (follow);
    `render/hud` timing tower (lap, timer, S1–S3, last/best), speed + throttle/brake, intro/finish cards.
  - `ui/animator` Edit/Animate tabs, transport bar under canvas, camera/theme/car/laps/playback speed,
    settings persisted; Space/←/→, tap to play.

- Scale + map (76 tests, verified in browser at JIExpo Kemayoran):
  - TrackDoc `mpu` (m per unit) + `crs:'mercator'`. Calibrate (tap A,B + real metres), or typing lap length
    fixes mpu; shape edits keep lengthKm in sync (`syncLength`). Animation scale bar.
  - `geom/tiles` map units = Web Mercator m (y down), slippy z/x/y math; `render/tiles` OSM TileLayer
    (crossOrigin, parent-tile fallback, LRU 400, `ready()` for export). Editor "Draw on map": Nominatim
    search, tap-to-trace, view persisted; KML/GPX now land on real coords with basemap. Animate theme
    "Map" = screenshot or muted OSM tiles; attribution drawn on canvas + HTML link.

## Next
- Phase 5 Export: MediaRecorder MP4/WebM at 720p/1080p, 30/60 fps from an offscreen canvas driven by
  fixed timestep (renderer is resolution independent: render(ctx,w,h,dpr,t)); PNG frame; JSON; polish.

## Open issues / env notes
- Export with map theme: wait for `tiles.ready()` per frame (follow-cam pulls new tiles); keep OSM
  attribution in the video. OSM tile/Nominatim usage policy: light, user-initiated use only.
- Hidden/background tabs defer ResizeObserver + rAF: canvas may be 1x1 until first render.
- Start/finish after detection is arbitrary (where the loop trace began); user sets it + Reverse.
- Large close radius could merge parallel straights (only used on retry when loop stays open).
- `img.decode()` stalls in background tabs: use onload. Hidden tabs throttle rAF to ~2/s: export must
  not depend on rAF cadence (fixed-step timer or warn user to keep tab visible). Local harness `tests/_local/` (gitignored).
- Dev server for browser pane: `.claude/launch.json` ("dev", node + vite.js, port 5173).
- Node/Git installed via winget; refresh PATH in new shells. esbuild install script approved.
