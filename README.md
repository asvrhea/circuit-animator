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

## Animating and exporting

The **Animate** tab simulates the lap: corner speed from curvature and grip, with acceleration and
braking limits, a standing start on lap 1, sector times and a speed readout. Choose camera (full track
or follow), theme (broadcast or map), car (Formula / GT / Road car), laps and playback speed.

**Export**: *Record video* renders 720p/1080p at 30/60 fps, in 16:9 landscape or 9:16 vertical (for Reels, Shorts and TikTok), and downloads MP4 where the browser
supports it (Chrome, Edge, Safari), otherwise WebM. Recording runs in real time at the chosen playback
speed, so keep the tab visible; it pauses if you switch away. *PNG frame* saves the current frame in the same format. The Animate view always shows the exact export frame, letterboxed.

Map tiles and place search © OpenStreetMap contributors. No series, team or trademarked graphics.

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
