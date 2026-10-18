# Circuit Animator — Claude Code starter kit

## What's inside
```
PROMPT.md                                  kickoff prompt to paste into Claude Code
CLAUDE.md                                  short project memory (loaded every session)
.claude/skills/circuit-animator/SKILL.md   phases, layout, model routing, token rules
.claude/agents/scout.md                    Haiku  – cheap file lookups
.claude/agents/runner.md                   Haiku  – runs tests/build, reports failures only
.claude/agents/builder.md                  Sonnet – implements well-specified modules
```

## How to use
1. Make an empty folder, unzip this kit into it (keep the hidden `.claude` folder), and run `git init`.
2. Open a terminal there and run `claude`.
3. Type `/model` and choose Opus (medium effort if offered).
4. Paste everything below the `---` line in `PROMPT.md`.
5. After each phase, Claude stops with a summary. Run `/compact` (or `/clear`, then "read PROGRESS.md and continue with phase N").
6. When Phase 2 is done, give it one of your real Google Maps screenshots to tune detection.

## Why this saves tokens
- Opus only does planning and the two hard algorithms; Sonnet writes routine code; Haiku does lookups and test runs.
- Test and build output is summarised by `runner` instead of filling the main context.
- PROGRESS.md + phase breaks let you clear context between phases without losing your place.
- `/usage` inside Claude Code shows what you've used against your plan.
