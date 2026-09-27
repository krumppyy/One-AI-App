# Text Reader — roadmap

Tab order: Image · Video · Reader · Voice. Reader extracts text from files,
turns it into a narration script, and hands named scripts to the Voice tab.

## Shipped (v1)

- Dropzone + picker: txt, md, pdf, docx, images, html, srt/vtt, csv/tsv, json, rtf.
- PDF text layer via pdf.js; scanned pages auto-fall back to per-page OCR.
- Image OCR via tesseract.js (eng), with progress in the status line.
- Legacy .doc refused with a plain-words message (re-save as .docx/.pdf).
- Editable extracted text; three narration styles (clean read / voiceover /
  summary) × four tones via the built-in text AI, streamed with Stop.
- Named document library (this browser, 20 docs) with Edit / → Voice / Delete.
- Voice tab gains a "From Reader" picker that loads any saved document.
- "→ Send to Voice" copies narration (or raw text) into the Voice script box.

## Next

1. More languages for OCR (tesseract traineddata picker, starting with the
   most-requested ones) + auto-detect so a letter in another language just works.
2. Multi-page / batch queue: drop 10 files, watch each extract in turn, merge
   into one script with chapter headings.
3. Narration upgrades: target duration (e.g. "60 seconds" rewrites to fit),
   per-paragraph voice direction marks, glossary for names/terms the AI
   keeps misreading.
4. Handoff upgrades: send narration straight into Voice as queued lines with
   per-line voice/speed, not just one script box fill.
5. Privacy switch: "extract only on-device" mode that disables the AI rewrite
   (extraction already never leaves the device; only Generate narration calls
   the text AI).
6. Export: download narration as .txt/.srt/.vtt for captions and editors.
7. Docs-as-source for other tabs: use a Reader script as the Video prompt or
   the Image prompt in one click.
