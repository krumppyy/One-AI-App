# Face-locked image-to-image — krumppy's design (saved 2026-09-27)

Source: krumppy's own Python reference (kept verbatim in chat history). This file is the
durable memory: a new chat resumes from here. Goal: edits that keep the SAME face with a
measured accuracy score, improving round over round.

## Pipeline (krumppy's reference)

1. **FaceDetector** — YOLOv8n-face on GPU, MediaPipe short-range (model_selection=0,
   min_detection_confidence=0.5) on CPU. Returns bbox + crop + confidence. Crop padded
   20% each side, clamped to frame.
2. **LightweightFaceEncoder** — 3 conv blocks (16/32/64) + GAP + 128-dim FC, L2-normalized
   for cosine similarity. ~200K params, CPU-friendly. Pretrained option: facenet-pytorch
   InceptionResnetV1 (vggface2).
3. **FaceLockImg2ImgPipeline** — StableDiffusionImg2ImgPipeline (SD 1.5) + reference face
   embedding. Knobs: strength 0-1, guidance 7-15, face_lock_weight 0-1.
4. **FaceAttentionInjector** — hooks on UNet cross-attention (attn2); latent-space face mask
   from bbox scaled 1/8 (512px basis), Gaussian-blurred edges; identity injected per step.
5. **Postprocess face blend (the accuracy guarantee)** — detect face in output, resize
   original face to match, cv2.addWeighted blend by strength, feathered mask (feather=15,
   Gaussian blur) for seamless edges. Blends ORIGINAL pixels back, so identity holds even
   when diffusion drifts.
6. **FaceLockedLoRA** — LoRA r=8 on to_k/to_q/to_v/to_out.0; loss = MSE noise + 0.5 ×
   (1 − cosine similarity) identity loss; 10 epochs, lr 1e-4, batch 2.
7. **Low-end** — attention slicing, xformers, fp16, model CPU offload; fast preset:
   30 steps, guidance 7.0, 384px, strength 0.7. Small-model alternative: SSD-1B (~1B).

## Build plan for THIS app (in order)

- **P1 — browser face blend (no server, no pool):** reuse the repaint-dialog pattern from
  `src/nsfw.js` + `torsoMaskBox` (native FaceDetector already in use). Detect face box in
  reference and in generated frame, feathered-blend reference face back by adjustable
  strength. Works with ANY image route (own Perchance model included). Scored by
  `imageChange()`-style face-region comparison in `src/image.js`.
- **P2 — server SD1.5 img2img:** new `family: "sdxl-i2i"` entry in `src/server/server.py`
  registry (strength/guidance/steps/seed args), free Colab T4 OK for 1.5 raízes.
- **P3 — LoRA per-person:** train on user's Colab from 3-5 photos, attach via existing
  LoRA adapter layer (`ensure_loras`); app sends `loras: ["facelock-<name>"]`.
- **Accuracy score:** face-region cosine/Δlum before-vs-after per generation, printed in
  the Image run log; keep best-of-N. Target: ≥90% same-face across pose/background changes.

## Learned (prompt-level, own Perchance model, 2026-09-27)

- Without style lock the model drifts young + illustrated (standing test: 68%).
- Fix that held 90-93%: `photorealistic photograph, mature face` + negatives
  `anime, cartoon, illustration, painting, cgi, 3d render, plastic skin, young teen`.
- Reference-anchored NSFW series 8001→8007: window daylight 90%, sofa recline 92%,
  standing re-shot 91%, hands-visible pass (5 fingers, natural nails).

## Measured on 1_Final.jpg (2026-09-27, live)

- SFW edit (horde-xl, strength 0.5): pool had no jobs → on-device remix (tinted copy).
- NSFW edit (explicit-sdxl, strength 0.65): delivered but drifted — different woman, still clothed, button/nipple artifacts.
- Face-lock rescue on the drifted frame: 32% → 82%, her eyes/brows/lips/moles back, seam ~invisible.
- Score = eye-landmark-aligned gray correlation mapped (rho-0.65)/0.35: self 100 (1.0), locked 82 (0.938), same-photo tint-crushed 45 (0.806), stranger 32 (0.763).
- Bugs fixed on the way: esm.sh blazeface interop (`mod.default || mod`, also in nsfw.js), core-pass source-rect sampling wrong canvas space, full-paste 5px blur washing the transplant, MAD metric punishing global tone (→ correlation).

## Update (2026-09-27, concealer v2 + pose range)

- Tone match is now Reinhard mean/std per channel on the face interior (gain
  clamped 0.45–2x), so one path covers pale through deep skin instead of a
  single mean shift tuned for one tone. Self-blend still 82 (0.936).
- Seam ring widened with ring-only grain (face interior untouched).
- 15 pose presets: 10 same-room (¾ left/right, profile, smile, laugh, look up,
  lean in, over-shoulder, seated, hands in hair) + 5 new-place (café, street,
  park, sunset balcony, evening room, strength 0.72–0.75 + stronger 0.9 face
  re-lock). Photo lock + anti-anime negatives baked into every pose prompt.
