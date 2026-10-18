---
name: circuit-animator
description: Build and maintain the Circuit Animator app (screenshot or KML of a race circuit → lap animation → video export). Use for any work in this repo; it defines the phases, module layout, model routing and token rules.
---

# Circuit Animator — working rules

## Phases (one commit + PROGRESS.md update each)
1. **Scaffold**: Vite + TS + Vitest, folder layout below, empty canvas app, `npm run build` green.
2. **Extraction**: `src/vision/*` (mask, close, components, skeleton, loop, simplify/resample/spline) + synthetic-image tests. Hardest phase.
3. **Inputs + editor**: upload, eyedropper, tolerance, KML/GPX + Mercator, manual trace, point editing, start line, sectors, JSON save/load.
4. **Animation**: `src/sim/*` (curvature, speed profile, timing) + `src/render/*` (track, car, trail, HUD, cameras, themes).
5. **Export + polish**: MediaRecorder MP4/WebM, PNG, responsive layout, final pass.

## Layout
```
src/vision/   pure functions on ImageData / Uint8Array masks
src/geom/     Vec2, spline, resample, curvature, projection
src/sim/      speed profile, lap timing
src/render/   canvas drawing, cameras, themes
src/ui/       DOM wiring only
src/main.ts
tests/        *.test.ts mirroring src/
```
Keep vision/geom/sim free of DOM so they test fast in Node.

## Model routing
The main session (Opus) plans, owns architecture and writes the hard algorithms (loop ordering, speed profile). Delegate the rest:

| Job | Agent | Model |
|---|---|---|
| Find code, list files, answer "where is X" | `scout` | haiku |
| Run tests/build/lint and report only failures | `runner` | haiku |
| Implement a well-specified module, UI wiring, CSS | `builder` | sonnet |

Delegate only when the task is self-contained and you can specify it in a few lines (inputs, outputs, file paths, acceptance test). Each spawn starts cold, so do tiny edits yourself rather than spawning one.

## Token rules
- Read narrowly: Grep first, then Read with offset/limit. Never re-read a file you just edited.
- Don't dump big outputs. Run tests with a quiet reporter (`npx vitest run --reporter=dot`) and pipe long output through `tail -40`.
- Never paste pixel arrays, base64 images or minified code into context. Downscale any test image to ≤ 400px before viewing it.
- Write a module's types/signatures first, then fill bodies; use Edit instead of rewriting whole files.
- Keep CLAUDE.md and this skill short; put progress in PROGRESS.md (≤ 30 lines: done, next, open issues).
- At the end of each phase: commit, update PROGRESS.md, and suggest `/compact` (or `/clear` + "read PROGRESS.md" before a fresh phase).
- No new dependencies without asking.
- Use high effort only for Phase 2 loop ordering and Phase 4 speed profile; medium elsewhere.

## Definition of done per phase
Tests pass, `npm run build` passes, PROGRESS.md updated, committed, 3-line summary to the user.
