# Progress

All five phases done. 94 tests, `npm run build` green (81 kB JS, 30 kB gzip), verified in the browser pane.

## Done
- 1 Scaffold: Vite 6 + TS strict + Vitest 3; dark broadcast UI, stacks on phones.
- 2 Extraction (`vision/`): chroma-HSV mask, chamfer close (retry 2r/3r), seeded component, Zhang–Suen,
  graph loop ordering (spur prune, turn-penalised longest cycle, figure-eight Euler walk, hairpin recovery).
  Tuned on user's real hand-drawn phone screenshot.
- 3 Inputs + editor: screenshot/KML/GPX/JSON/manual trace; drag/insert/delete/undo, start, sectors, autosave.
- 4 Animation (`sim/`, `render/`): curvature speed profile (fwd/back passes, friction circle, standing start),
  race timeline, HUD, full/follow cameras, broadcast/map themes.
- Scale + map: calibration (A→B metres) and typed length fix `mpu`; OSM "Draw on map" with Nominatim search;
  KML/GPX on real coords; map theme in animation with attribution.
- 5 Export: `io/video` (MP4-first format pick, bitrate, names, letterbox, 16:9 or 9:16 frameSize) + `ui/exporter` (offscreen
  720p/1080p canvas, captureStream(0)+requestFrame, MediaRecorder, wall-clock race time × speed, pauses
  recording while tab hidden or map tiles loading, refuses empty output); PNG frame; JSON. Verified: 720p30
  MP4 plays (1280x720, 10.9 s), 1080p PNG. README rewritten as app docs.
- 9:16 vertical export (720x1280 / 1080x1920); Animate view letterboxes the exact export frame; exporter race
  time follows the wall clock uncapped (fixes slow-motion videos when frames are slow).
- Disciplines (JSON `discipline`: formula | rally | mix, `gravel`: [[from,to]] fractions): rally = open point-to-point
  stage (open spline/curvature, standing start + flying finish, one run, splits, START/FINISH, cool-down past finish),
  mix = closed circuit with gravel stretches; surface grip scales speed profile; Rally car preset; Mark gravel/tarmac
  tool; KML/screenshot lines with two ends load as stages; Straighten/Corner disabled on stages (follow-up).
- Editor tools: Straighten (two taps → exact straight via collinear helper points, start kept); Corner
  (tap → slider scales the corner about its vertex, tighter = slower in Animate). Both undoable.

## User's track (in browser-pane storage)
- Drawn on the OSM map near JIExpo Kemayoran: 31 points, 4.593 km (Formula preset flying lap ≈ 1:16).

## Ideas / open issues
- Corner opening is capped where entry/exit would pass the next control (single-point corners barely open).
- Start/finish after screenshot detection is arbitrary; user sets it.
- WebM from MediaRecorder lacks duration metadata in some players (MP4 preferred where available).
- Hidden tabs throttle rAF/ResizeObserver; recording pauses while hidden (by design).
- OSM tile + Nominatim usage policy: light, user-initiated use only; attribution always shown.
- Dev handle `window.__app` exists only in dev builds. Local harness `tests/_local/` (gitignored).
- Node/Git installed via winget; refresh PATH in new shells. esbuild install script approved.
