# SDXL AI director (`src/sdxl-ai.js`)

Races the SDXL edit routes with a learned policy, verifies as results land,
and understands beautify/body words. Built on `src/sdxl-edit.js` (strength
ladder, prompt compiler, face-lock); this file is the brain, that one the hands.

## How it gets faster without losing accuracy

- **Hedged race**: best-predicted route starts immediately, the next starts
  20s later. First candidate scoring face ≥ 60 wins and the losers are
  cancelled. Slow queue? The other route is already warming up.
- **Learned routing**: per-route latency / success / face averages persist in
  kv (`sdxl-ai`) and order the next race. Cold start assumes all equal.
- **Same accuracy bar**: every candidate is face-scored + change-measured;
  best score wins if nothing passes. Face-lock transplant still finishes.
- 7-minute route cap so one stuck queue can never hang the run.

## Model list (Image model dropdown)

- SDXL Fast (SFW) / SDXL Fast NSFW — hedged race, first verified pass wins.
- SDXL Accurate (SFW) / SDXL Accurate NSFW — sequential verify + retry ladder,
  best score wins. Same params, same naming, `-nsfw` suffix flips the route
  pool to uncensored.

## Prompt understanding

- "make me look good / beautiful / gorgeous / glow" → glowing skin, natural
  makeup, defined eyes, flattering face light.
- "big boobs / busty / cleavage / curvy / sexy / slim waist / tan / fit" →
  tasteful flattering-shape tokens (clothed framing; never auto-nudifies —
  explicit undress stays on the NSFW storyboard path).
