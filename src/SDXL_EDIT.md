# SDXL face-preserving edit algorithm (`src/sdxl-edit.js`)

Inherits the app's SDXL edit routes (Horde SDXL pool, Qwen-Image-2.1) and
betters them for one job: new pose / new place, same woman.

## Training notes (external)

- diffusers img2img: `strength` is how much noise is added to the input photo
  before denoising — it is literally how much of the photo survives. Low
  strength keeps structure/identity, high strength re-imagines. Steps scale
  with it. Default 0.8 is far too destructive for identity work.
- InstantID (InstantX): tuning-free identity needs its own conditioning path —
  a face embedding (antelopev2) injected through an IdentityNet plus 5-point
  landmark conditioning, decoupled from the text cross-attention. Prompt words
  alone cannot hold a face. Our P1 approximation: calibrate strength per
  intent + verify with a face score + transplant the original face back.
  A landmark/embedding-conditioned route is the P2 upgrade.

## The algorithm

1. **Intent ladder** — `keep` 0.42 (expression only), `evolve` 0.55 (head/body
   turn, same room), `relocate` 0.72 (new place). Chosen from the preset's
   environment and strength, not guessed per run.
2. **Prompt compiler** — identity anchor + photo lock + drift negatives on
   every job. For `relocate` the scene lock is *released* (`sceneLock: "free"`):
   the old pipeline appended "same room / same location" tokens that fought
   the new-place prompt and either won (no relocation) or lost messily.
3. **Route ladder** — explicit SDXL route, then Qwen edit, each tried at the
   intent strength and once more adjusted (softer for identity, harder for
   relocation). No silent offline tinted fallback inside the SDXL path.
4. **Verify + best-of** — every candidate is scored (`faceScore`) and measured
   (`imageChange`; a relocation must actually change the picture). First
   candidate passing face ≥ 55 wins; otherwise the best score wins. Then the
   standard face-lock transplant + seam concealer.

## Measured

- 1_Final.jpg smile (evolve): 67% · café (relocate): 68%, same woman, daylight
  café background where the old same-room lock used to keep the bedroom.

## Inpainting + detail training (accurate path, SFW and NSFW identical)

- **Face-protect inpainting**: same-angle and new-place presets send a
  face-ellipse mask with the job — the model repaints everything *except* her
  face, so background/pose change while identity is pixel-guaranteed. Head-turn
  presets (profile, ¾s, over-shoulder) skip the mask since the face itself
  must move, and get a stronger 0.92 re-lock instead.
- **Eye training**: every final is eye-measured (sharpness + left/right
  symmetry + tone). Soft eyes (< 8) trigger exactly one sharp retry with
  eye-boost tokens at slightly lower strength. Eye tokens ride on all jobs.
- **Pixel detail pass** (`src/detail.js`): landmark-aimed clarity on eyes and
  nose, blotch-erase on skin outside the face (arms, hands, limbs, nails
  zones) — the small things human eyes catch first.
- NSFW accurate uses the identical algorithm; only the route pool flips to
  uncensored (`-nsfw` models).
- **Surface pass** (`surfacePass`): full-frame, not just skin — edge-aware
  smoothing for rough surfaces, cloth edges and scene backgrounds, plus
  defringing on high-contrast edges. Proven on 1_Final.jpg with zero damage.
