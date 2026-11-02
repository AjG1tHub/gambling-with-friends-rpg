# art/style — the approved style sheet

Approval gate 1 of the art pipeline. `node tools/art/style-sheet.mjs --import` copies the twelve Midjourney
references from `art/inbox/midjourney/style__<id>.png` to `<id>.png` here and lists them in `refs.json`;
`--approve monster,item,… --sref <ids>` records the approved set and copies each approved image into `icons/` or
`portraits/` (the LoRA training seeds for `npm run art:lora -- --kind icons|portraits`). Add further approved
generations to those two folders as they land: 25–40 images make a good LoRA. `refs.json` also holds the trained
LoRA URLs and the `--sref` ids every later Midjourney line carries. Everything here is committed.
