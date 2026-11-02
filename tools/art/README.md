# The art and sound pipeline — the loop on one page

Every image and sound the game ships lives at a path listed by `tools/asset-list.mjs` (629 rows). A placeholder is
a file carrying a marker (PNG `tEXt gwf-placeholder`, SVG `<!--gwf-placeholder-->`, WAV INFO comment); real art is
any file at the same path without it. `npm run gen` rebuilds `assets/manifest.json` and every renderer switches to
the real file on its own. This folder replaces placeholders with real assets, one group at a time, and can
regenerate any single one on demand. Nothing here edits game code, `data/*.json`, the manifest by hand or
`tools/asset-list.mjs`.

## Setup (once, on the PC with the 4070)

On Windows the whole of this section is one command from the repo root:
`powershell -ExecutionPolicy Bypass -File tools/art/setup.ps1` (installs what is missing, runs `npm ci`, writes the
`.env.local` template, probes the APIs once keys are in). By hand:

1. `.env.local` (never committed): `PIXELLAB_API_KEY`, `FAL_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`;
   optional `ART_BUDGET_USD` (default 25 per run), `FAL_T2I_MODEL`, `FAL_LORA_MODEL`, `FAL_TRAINER_MODEL`,
   `GEMINI_IMAGE_MODEL`, `ART_PYTHON`, `ART_BODY_REF` (the body sheet worn layers are drawn on, default `1_1`).
2. Python 3 with `pillow` (required), `rembg` + `onnxruntime-gpu` (cut-outs; falls back to a corner flood fill),
   `pyloudnorm` + `numpy` (−16 LUFS; falls back to RMS), and `ffmpeg` on the PATH (MP3 input, loop decoding).
3. `npm run art:probe` — fetches each API's live schema and flags any field an adapter sends that the schema does
   not list, so API drift is a one-line fix in the adapter instead of a failed batch.
4. `npm run art:notes` — refreshes `art/notes.json` from `docs/ASSET-LIST.xlsx` (the `{notes}` slot).

## The loop

```
npm run art:style -- --queue           write the 12 style-sheet prompts to art/midjourney/queue.md
   (run them in Midjourney → art/inbox/midjourney/style__<id>.png)
npm run art:style -- --import          → art/style/<id>.png, visible on /lab/?art=1 (npm run art:review)
npm run art:style -- --approve monster,boss,item,… --sref <id> <id>      ← approval gate 1
npm run art:lora -- --kind icons       train the icon LoRA on art/style/icons (and --kind portraits)
npm run art -- --priority P1 --group items --only items/coinblade*   first 10 of each P1 group
   (review on /lab/?art=1, Approve / Redo / Redo with note)          ← approval gate 2
npm run art -- --redo                  regenerate every row marked redo (new seed; the note goes into the prompt)
npm run art -- --priority P1           every P1 group, then --priority P2, then P3
npm run art:import                     pick up Midjourney / Suno drops from art/inbox/<tool>/
npm run art:report                     progress by group and priority, verdicts, total spend
```

After each group: `npm run gen` → `npm run test:unit` (must stay green; `test/unit/art-pipeline.test.mjs` covers
the templates and post.py) → `npm run build` → commit `assets/` for that group with `art/ledger.json` → push (CI
deploys). One group per commit, so a bad batch is one revert.

## What is where

| Piece | Path | Role |
| --- | --- | --- |
| Driver | `tools/art/pipeline.mjs` | `--group --priority --only --force --dry-run --import --redo --probe --tool --verbose` |
| Rows, slots, templates, ledger, review | `tools/art/lib.mjs` | `toolFor(row)` is the routing; `slotsFor(row)` reads the data files |
| Prompt templates | `tools/art/prompts/<group>.md` + `_style.md` | `## prompt` body, `## negative`, `## variants` (`- key:` prepends, `= key:` replaces; `key_` prefix, `*key` suffix) |
| Adapters | `tools/art/adapters/` | `pixellab` (sprites, pets, lantern), `fal` (icon sets, frames, wheel rims, UI), `gemini` (edits: pet stages, tokens), `elevenlabs` (cues), `manual` (Midjourney, Suno queues + inbox) |
| Post-processing | `tools/art/post.py` | cut-out, trim, pad, nearest/Lanczos, ≤32-colour quantise, sprite strips, layer diff, 9-slice, wheel SVG, SVG wrap, audio |
| Review page | `apps/lab/screens/art.js` (`/lab/?art=1`) | placeholder vs real, composited layers, pet stages, spinning wheels, verdicts |
| Review server | `tools/art/review-server.mjs` | `npm run art:review`: JSON API on :8791 + Vite; writes `art/review.json` |
| Ledger | `art/ledger.json` | per key: tool, model, prompt hash, seed, attempt, cost, licence, date, verdict |
| Style sheet | `tools/art/style-sheet.mjs`, `art/style/` | the 12 references, approval, `--sref` ids, LoRA URLs |
| Inbox / cache | `art/inbox/`, `art/cache/` | gitignored: manual drops, raw model output, job files |

## Rules the code enforces

- A row is skipped when a real file already exists, unless `--force` or the reviewer marked it redo.
- Seeds are `hash32(key)` (`hash32(key#attempt)` on a redo), so a regenerated asset lands in the same style.
- Every file lands at exactly `row.path` and `row.size` (or the row's sprite strip); PNG with alpha for cut-outs,
  SVG for wheels/cards/ui/tv, WAV 48 kHz 16-bit mono at −16 LUFS for sound. The placeholder marker is never written.
- Pixel groups get hard pixels (chroma-keyed, pixel-gridded, quantised, nearest-neighbour); painted groups get
  Lanczos and rembg cut-outs. Wheel faces are rim + hub + unstyled `<g id="segments">`; odds are never baked.
- `ART_BUDGET_USD` stops a run before it overspends; the ledger keeps the running total.
- FLUX.2 [dev] is refused (non-commercial) unless `FAL_ALLOW_DEV=1`; the licence is recorded per asset.
- Rows the inventory gets wrong (size, frames) are reported, never "fixed" by changing `tools/asset-list.mjs`.
