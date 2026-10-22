# Circuit Animator

Turn a race circuit you drew into a broadcast-style lap animation and export it as a video.
Runs entirely in the browser: no backend, no account.

```bash
npm install
npm run dev
```

## Making a track

| Source | How |
|---|---|
| **Screenshot** | Drop a PNG/JPG of the line you drew on a map, then tap the line to sample its colour. Adjust *Tolerance* if detection misses or over-grabs. |
| **Draw on map** | Search a place (OpenStreetMap), tap *Draw track* and tap along the roads. Scale is exact. |
| **KML / GPX** | Export from Google My Maps (or any GPS app) and drop the file. Real coordinates and length. |
| **Manual trace** | On a screenshot, tap points around the circuit yourself. |
| **Track JSON** | Re-open a track you saved. |

Editing: drag points, tap the line to add one, right-click or long-press to delete, Ctrl+Z to undo.
*Set start* moves the start/finish line, *Reverse* flips direction, *Place S2/S3* sets sector splits.

**Scale.** Speeds and lap times depend on the real lap length. For screenshots, either type the lap
length (e.g. measured in My Maps) or use *Calibrate scale*: tap two points and enter the real distance
between them (Google Maps → long-press → *Measure distance*). Map and KML tracks already know their scale.

### Disciplines

Pick one in the Track section.

- **Formula**: closed circuit, all tarmac.
- **Rally stage**: a point-to-point run. The first point is the start and the last point the finish, with no laps. The stage is gravel unless you mark tarmac.
- **Mix**: closed circuit with gravel stretches.

Use *Mark gravel* or *Mark tarmac* (rally and mix), then tap where the stretch starts and where it ends. A KML/GPX file or a detected or drawn line with two ends loads as a rally stage; use *Finish as stage* when tracing.

Track JSON fields: `discipline` (`"formula"` | `"rally"` | `"mix"`) and `gravel` (`[[from, to], ...]`, fractions of track length).

## Animating and exporting

The **Animate** tab simulates the lap: corner speed from curvature and grip, with acceleration and
braking limits, a standing start on lap 1, sector times and a speed readout. Choose camera (full track
or follow), theme (broadcast or map), car (Formula / GT / Road car), laps and playback speed.

**Export**: *Record video* renders 720p/1080p at 30/60 fps, in 16:9 landscape or 9:16 vertical (for Reels, Shorts and TikTok), and downloads MP4 where the browser
supports it (Chrome, Edge, Safari), otherwise WebM. Recording runs in real time at the chosen playback
speed, so keep the tab visible; it pauses if you switch away. *PNG frame* saves the current frame in the same format. The Animate view always shows the exact export frame, letterboxed.

Map tiles and place search © OpenStreetMap contributors. No series, team or trademarked graphics.

## Race

The **Race** tab turns the current track into a simple top-down racing game (it needs a track, like Animate).

- **Controls**: W / ↑ gas, S / ↓ brake then reverse, A D / ← → steer, Esc pauses. On touch devices on-screen hold buttons appear (◀ ▶ bottom-left, ▲ gas and ▼ brake bottom-right); they are multi-touch so you can steer and accelerate together. Add `?touch=1` to the URL to force them on a desktop.
- **Driving model** (`src/game/car.ts`): real units (m, m/s) and the same car presets as Animate (Formula on circuits, Rally car on mix and stages). Steering is near-instant (full lock in 0.1 s) and gets less sharp with speed; tyres have a grip limit and the car only slides when it is exceeded; gravel stretches have much less grip. Physics runs on a fixed 240 Hz step, so it plays the same at any frame rate.
- **Walls** (`src/game/wall.ts`): the 12 m wide road is edged by a soft, elastic barrier (spring-damper): you bounce back inward and lose speed, never get stuck in or through it, and the barrier lines the car up with the road. Rivals get the same barrier.
- **Pace notes** (`src/game/pacenotes.ts`): a callout ahead of each corner, e.g. RIGHT 3 · 150 m with an arrow and a severity from 1 (hairpin) to 6 (flat-out kink), read from the path curvature. Works on circuits and stages; Off / On screen / On screen + beep in the panel.
- **Map theme** locks one tile zoom for the whole race and prefetches the tiles around the track at the start, so driving never waits on tile work.
- **Circuits** (formula and mix): 5–9 AI rivals with fictional drivers and 3-letter codes (nothing from real series), a 5-light start, laps, live positions and gaps, best lap and a results table. AI cars follow the speed profile (with surface grip) scaled by a skill factor, use their own lane, pass or back off slower cars, and collide with you and each other. Difficulty scales the rivals' pace.
- **Rally stages**: no rivals. A solo time trial from START to FINISH with split times and a finish result.
- Camera is heading-up or north-up; theme is broadcast or map (screenshot / OSM tiles), same as Animate.

## Development

```bash
npx vitest run --reporter=dot   # unit tests (geometry, vision, sim, io)
npx tsc --noEmit                # type-check
npm run build                   # production build to dist/
```

Code: `src/vision` (line extraction), `src/geom`, `src/sim` (speed profile, timing), `src/render`
(editor, animation, HUD, tiles), `src/ui` (DOM wiring). Progress notes live in `PROGRESS.md`.

<details>
<summary>Claude Code starter kit</summary>

`PROMPT.md` is the kickoff prompt; `CLAUDE.md` and `.claude/skills/circuit-animator/SKILL.md` hold
the working rules; `.claude/agents/` defines the scout (Haiku), runner (Haiku) and builder (Sonnet)
helpers. After each phase, `/compact` or `/clear` then "read PROGRESS.md and continue".
</details>
