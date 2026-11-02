# Build prompt: the art and sound pipeline for GWF RPG Edition

Paste everything below this line into a Claude Code session opened on the PC with the RTX 4070, with the repo
`AjG1tHub/gambling-with-friends-rpg` cloned and the API keys in `.env.local` (never committed).

---

You are building the art and sound pipeline for **Gambling With Friends: RPG Edition**, a browser party game
whose code is finished and deployed (https://gwf-rpg.netlify.app). Every image and sound in it is currently a
generated placeholder. Your job is to replace all 629 of them with real assets, in order of priority, without
touching game code, and to leave behind a pipeline that can regenerate any one of them on demand.

Work autonomously end to end. Do not pause to ask questions you can answer from the repo or from this prompt.
The only places you stop are the two **approval gates** below, because they need a human eye.

## Read first (in this order)

1. `docs/SPEC.md` › **Art direction: grimdark casino** and **Asset list and generation plan** — the look, the
   palette, the region table, the tool choices and the pipeline sketch. The art direction is law.
2. `tools/asset-list.mjs` — the inventory as data: `buildAssetList()` returns one row per file with `key`,
   `group`, `path`, `kind`, `size`, `genSize`, `priority`, `name`, `meta`, and for paper-doll layers a `sprite`
   block (`slot`, `z`, `poses`, `frames`, `frameW`, `frameH`). `PALETTE`, `SECRET_COLOURS`, `RARITY_COLOURS`,
   `FAMILY_COLOURS`, `FRAME`, `BODY_POSES`, `ARMOUR_POSES`, `POSE_ORDER`, `LAYER_Z`, `SOUND_CUES`, `MUSIC_LOOPS`
   are the constants every asset must respect.
3. `docs/ASSET-LIST.xlsx` — the same rows with prompt notes per asset (names, flavour text, region, element,
   footprint) and a suggested tool per group. Read it with pandas; it is the human view of (2).
4. `tools/placeholders.mjs` and `tools/build-manifest.mjs` — how a file is recognised as a placeholder (a PNG
   `tEXt` chunk `gwf-placeholder`, an SVG leading comment `<!--gwf-placeholder-->`, a WAV INFO comment). A
   real asset is simply a file at the same path **without** that marker; `npm run gen` rebuilds
   `assets/manifest.json` and every renderer switches to real art when `placeholder` turns false.
5. `packages/ui/sprite.js` — how the paper doll is drawn: 64×96 frames, body sheets of 22 frames (idle 4,
   attack 6, hit 2, death 6, step 4, left to right), armour/weapon layers of 5 frames (one per pose) that the
   code moves with per-frame offsets, the hand anchor boxes (`mainhand` at x 48 y 28, `offhand` at x 12 y 34,
   helmet, gloves, necklace, cape boxes), layer z-order, the rarity trim/glow drawn by code (do not bake frames
   or glows into sprites), and the lantern tell. Pet sheets: 128 px frames, `frames` per the row.
6. `packages/ui/wheel.js` — wheel faces: the renderer draws **weighted slices itself** and only inlines a painted
   face (`assets/wheels/<id>.svg` with `<g id="segments">` and `<g id="labels">`) when every segment has the same
   weight. So wheel art is rim, hub, pointer and segment styling, never baked odds.
7. `data/monsters.json`, `data/pets.json`, `data/legendaries.json`, `data/items36.json`, `data/bases.json`,
   `data/regions.json`, `data/tiles.json`, `data/classes.json` — names, flavour text and ids. Prompts come from
   these, never from memory.
8. `test/unit/generated.test.mjs` — the CI test that every listed path exists. It must keep passing.

## Tools and accounts

The spec's tool table stands. Concretely:

| What | Tool | How you reach it |
| --- | --- | --- |
| Style sheet, monster/boss portraits, region ground/void textures, stage backdrops, map parchment and cartouches, key art | **Midjourney** (style references + `--cref`/`--sref`) | No API: you write the prompt batch to `art/midjourney/queue.md` with one line per asset (prompt, aspect, seed, `--sref` ids); AJ runs them and drops the results into `art/inbox/midjourney/<key>.png`; your importer picks them up by filename. |
| Paper-doll body sheets, faces, hair, class outfits, worn-item layers, Legendary layers, lantern, pets (3 stages), monster hex tokens | **PixelLab** API (`PIXELLAB_API_KEY`) | Character generation + animation endpoints at 64×96 (sprites) and 128 px (pets/tokens); request every pose/frame the row needs; keep the character reference id per body build so faces, hair and outfits line up. |
| Item icons, gear icons, consumables, tile glyphs, badges, letters, cards, dice, UI icons — any **set** that must match | **FLUX.2** on **fal.ai** (`FAL_KEY`) with one style LoRA per icon family, trained on the approved style-sheet icons; **Retro Diffusion** in Aseprite locally for pixel batches when the 4070 is free | fal.ai REST; fixed seed per row (`hash32(key)`), one prompt template per group with the row's name/flavour slotted in. |
| Edits that must stay consistent (pet stage 2 from stage 1, armour recolours, rarity variants, token from portrait) | **Nano Banana** (Gemini image, `GEMINI_API_KEY`) | Image-to-image with the parent asset attached. |
| Cut-outs, trims, upscales | **rembg / BiRefNet**, **Real-ESRGAN**, Pillow, locally on the 4070 | Python in `tools/art/post.py`. |
| Music loops (one per region + lobby, fight, recap: `MUSIC_LOOPS`) | **Suno** | No API: prompt file `art/suno/queue.md`, results into `art/inbox/suno/`. |
| The ~40 sound cues (`SOUND_CUES`) | **ElevenLabs Sound Effects** (`ELEVENLABS_API_KEY`) | API; 3 variations per cue, you pick by loudness/length, normalise to −16 LUFS, 44.1 kHz 16-bit WAV. |

Licensing: ship only FLUX.2 [pro]/[klein] output (never [dev]); Midjourney, Gemini, PixelLab, Suno and
ElevenLabs on paid plans. Record the model and licence per asset in the ledger (below).

## What to build (`tools/art/`)

1. **`tools/art/pipeline.mjs`** — the driver. `node tools/art/pipeline.mjs --group monsters --priority P1
   [--only key] [--force] [--dry-run]`. For each row from `buildAssetList()` that matches: skip if a real
   (non-placeholder) file already exists unless `--force`; otherwise build the prompt from the template and the
   row's data, call the right adapter (or write to the manual queue), post-process, write the file at
   `row.path`, append to the ledger. Idempotent; safe to re-run; one row never depends on the network twice.
2. **`tools/art/prompts/<group>.md`** — one prompt template per group, with the style preamble (the art
   direction paragraph condensed to ~60 words, the region accent colour, the "one sickly neon per region" rule),
   `{name}`, `{flavour}`, `{region}`, `{accent}`, `{footprint}`, `{stage}`, `{element}` slots, and negative
   prompts (no text, no watermark, no glow on sprites, no background on cut-outs). Keep them in the repo so a
   regenerated asset lands in the same style.
3. **Adapters** in `tools/art/adapters/`: `pixellab.mjs`, `fal.mjs` (with `train-lora.mjs`), `gemini.mjs`,
   `elevenlabs.mjs`, `manual.mjs` (Midjourney, Suno: writes the queue, imports the inbox). Every adapter takes
   `(row, prompt, opts)` and returns a Buffer; keys from `.env.local` only; retries with backoff; a per-run spend
   cap (`ART_BUDGET_USD`, default 25) that stops the run rather than overspending.
4. **`tools/art/post.py`** — cut out (rembg), trim to content, pad to the spec size, nearest-neighbour for pixel
   groups and Lanczos for painted ones, palette-quantise sprites to ≤ 32 colours, assemble sprite strips
   (22 frames or 5 poses on the 64×96 grid, feet on the same baseline, hands inside the anchor boxes — read
   `sprite.js` and check the result against `tools/placeholders.mjs`'s layout), 9-slice the rarity frames,
   build the wheel SVGs (rim/hub/pointer only, segments as unstyled `<g id="segments">` with one `<path>` per
   label so the renderer can relabel them), normalise audio. Never write the placeholder marker.
5. **Review page** `apps/lab/?art=1` (a new Lab screen, `apps/lab/screens/art.js`): every asset as a card —
   placeholder on the left, real on the right at true pixel size and at TV/phone scale, the paper-doll layers
   composited on a body, pets at all three stages, wheels spinning, with **Approve / Redo (new seed) / Redo with
   note** buttons that write `art/review.json`; the driver reads it and regenerates the rejected rows. This is
   the only UI you add, and it never touches a real room.
6. **Ledger** `art/ledger.json` (committed): per key — tool, model, prompt hash, seed, cost, licence, date,
   reviewer verdict. Plus `npm run art:report` that prints progress by group and priority and total spend.
7. **npm scripts**: `art` (driver), `art:lora`, `art:review` (opens the Lab page), `art:report`, `art:import`
   (manual inbox). Add `tools/art/README.md` describing the loop in one page.

## Order of work

1. **Style sheet (approval gate 1).** Write the 12 Midjourney prompts from the spec (one monster, one boss, one
   item icon, one worn weapon sprite reference, one tile set, one card, one crest, one region ground, one stage
   backdrop, one pet, one wheel face, one lantern). Queue them, wait for the inbox, show them on the review page,
   and **stop** until AJ approves a set. Save the approved set as `art/style/` and their `--sref` ids.
2. Train the icon LoRA on fal.ai from the approved icons (and a second one from the portraits). Then generate
   **the first 10 of each P1 group** and **stop** for approval gate 2 — this is where the prompt templates get
   tuned. After that, no more gates: run every P1 group, then P2, then P3.
3. Sprites need their own pass: generate the body builds first (3 builds × 4 skins, same PixelLab character
   reference per build), then faces/hair/outfits against them, then worn layers against the Enforcer body in
   each pose, and check every sheet composited in the review page before moving on.
4. Sound: ElevenLabs cues from `SOUND_CUES`, Suno loops from `MUSIC_LOOPS`; the legacy synth cues stay as the
   fallback until a real file lands.
5. After each group: `npm run gen` (manifest), `npm run test:unit` (must stay green), `npm run build`, commit
   with the ledger, push (CI deploys). Commit real assets in batches of one group so a bad batch is one revert.

## Rules

- Never edit game code, `data/*.json`, `assets/manifest.json` by hand, or `tools/asset-list.mjs`. If a row is
  wrong (size, frames), say so in the report; do not change the inventory to fit the art.
- Every file lands at exactly `row.path` with exactly `row.size` (or the row's `sprite` strip), PNG with alpha
  where the group needs it, SVG for wheels/tv, WAV for sound. No extra files under `assets/`.
- Pixel groups (sprites, pets, tokens, items, gear, consumables, tiles glyphs, ui, badges, cards, dice): hard
  pixels, no anti-aliasing, no soft glow — the renderer scales with nearest-neighbour. Painted groups
  (monsters, stages, tiles ground/void, map, crest): painterly, alpha where cut out.
- One accent neon per region, everything else bone/oxblood/brass/velvet. Reject anything that reads as bright
  fantasy; this is a dead god's casino.
- The lantern is the only Health readout: its four states must be unmistakable at 24 px.
- Keys, costs and the inbox never go into git (`art/inbox/` is gitignored; `art/ledger.json`, `art/review.json`,
  `art/style/` and the prompts are committed).
- Finish with `docs/PROGRESS.md` appended: what landed, what is still placeholder, total spend, and the exact
  prompts/seeds that produced the approved style sheet.
