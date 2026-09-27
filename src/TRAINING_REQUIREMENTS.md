# Training requirements — krumppy's private builds

Private agent-side builds: image-to-video (SFW + NSFW) + LoRA + image-to-image (SFW + NSFW). Status: not started. App-side integration is done; this file tracks what the private training needs.

## Image LoRA (SFW + NSFW)

- GPU: RTX 4090 24GB / RTX 5090 / A10 24GB / L40S (any 1x 24GB+ card)
- RAM: 32GB+
- Storage: ~100GB SSD (datasets + checkpoints + outputs)

## Video LoRA (SFW + NSFW, image-to-video)

- GPU: A100 80GB / H100 / H200 (1x 40GB minimum, 80GB recommended)
- RAM: 60GB+
- Storage: ~300–500GB SSD (video datasets are heavy)

## Full model from scratch (not recommended)

- Multi-GPU cluster (8x H100 class), TBs of storage. LoRA fine-tune on top of Wan / LTX / Hunyuan bases is the sane path.

## Note

- Inference-only runs on far less (even a free Colab T4, see `src/colab/`).
- This file is notes only; it ships with the app but changes no code.
