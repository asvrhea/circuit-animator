# Kickoff prompt — paste this into Claude Code

> Before pasting: unzip this kit into an empty project folder, run `claude` there, and pick Opus with `/model` (medium effort if your version offers an effort setting). The skill and agents in `.claude/` load automatically.

---

Use the `circuit-animator` skill for this whole project and follow its token rules.

Build **Circuit Animator**: a browser app where I upload a screenshot of a race circuit I drew on Google Maps (a coloured line over the map), and it turns that line into an F1-style lap animation I can export as a video.

## Stack
- Vite + TypeScript, no UI framework, HTML Canvas 2D. Vitest for tests.
- No heavy dependencies (no OpenCV.js, no React). Write the image processing ourselves.
- Everything runs client-side. No backend.

## Inputs
1. **Screenshot upload** (PNG/JPG, drag-and-drop or file picker). This is the main path.
2. **KML / GPX upload** (Google My Maps export) as the precise alternative. Project lat/lon with Web Mercator.
3. **Manual trace**: click to place points on the image if detection fails.

## Track extraction (from screenshot)
1. User clicks the drawn line to sample its colour (eyedropper). Tolerance slider in HSV space.
2. Build a binary mask → morphological close to bridge small gaps (map labels, road crossings).
3. Keep the largest connected component.
4. Skeletonize (Zhang–Suen).
5. Order skeleton pixels into a single closed loop. Prune spurs, and if there are branches choose the longest cycle. Handle an open line by joining its ends.
6. Simplify (RDP), resample evenly by arc length (~500 points), smooth as a closed Catmull–Rom spline.
7. Show the result over the dimmed screenshot with a confidence hint (mask coverage and loop closure).

## Editor
- Drag control points, add a point (click on the segment), delete a point (right-click or long-press).
- Reverse direction; set start/finish line by clicking on the track.
- Optional: mark 3 sector split points (default: equal thirds by length).
- Save and load the track as JSON; autosave to localStorage (wrapped in try/catch).

## Animation
- Speed profile from curvature: `v = min(vMax, sqrt(aLatMax / curvature))`, then forward/backward passes to cap acceleration and braking. Corners must visibly slow the car.
- Car marker rotated to the heading, with a short fading trail.
- Track "draw-in" intro, then laps. Sector colouring, a lap timer, and live speed readout (km/h, scaled from a user-set track length in km).
- Camera modes: full-track view and follow-cam (zoomed, rotating with heading, smoothed).
- Themes: dark broadcast style (default) and "over original screenshot".
- Controls: play/pause, scrub, playback speed, laps count.

## Export
- Record the canvas with `canvas.captureStream()` + `MediaRecorder`. Prefer MP4 if `MediaRecorder.isTypeSupported` allows it, otherwise WebM. Resolutions 720p / 1080p, 30 or 60 fps.
- Export a PNG of the current frame and the track JSON.

## Design
- Clean, motorsport-broadcast look: dark background, bold condensed type, one accent colour. Do not use any F1 or team logos, names or trademarked graphics.
- Works on desktop and on a phone-width screen.

## Quality
- Unit tests for the pure geometry and image functions: mask, skeleton, loop ordering, resampling, curvature, speed profile, Mercator projection.
- Generate synthetic test images in code (a coloured loop drawn on noise, with a gap and a crossing road) rather than storing big fixtures.
- `npm run build` must pass with no TypeScript errors.

## How to work
Follow the phases in the skill. After each phase: run tests, commit, update `PROGRESS.md`, then stop and give me a 3-line summary before continuing. Ask me for a real screenshot of mine once Phase 2 is working so we can tune detection on it.
