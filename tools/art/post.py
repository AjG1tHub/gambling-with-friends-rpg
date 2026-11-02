#!/usr/bin/env python3
"""Post-processing for the GWF RPG art pipeline. Called by tools/art/pipeline.mjs with a job file; never writes
the placeholder marker, never touches game code.

  python3 post.py process <job.json>      run one job (see JOB SPEC below) and write the asset(s) at their path
  python3 post.py rgba <in.png> <out.rgba> decode any PNG to raw RGBA (u32le w, u32le h, then w*h*4 bytes)
  python3 post.py check                   report which optional tools are available (rembg, pyloudnorm, ffmpeg)

JOB SPEC (JSON): { "op": ..., "out": "<abs path>", "size": [w, h], "mode": "pixel"|"painted"|"vector"|"audio",
  "inputs": ["<abs png/pcm>", ...], "group": "...", "key": "...", ...op-specific fields }
  single      inputs[0] → cut out, trim, pad, scale to size, quantise if pixel                    (+ "chroma", "cutout", "margin", "quantize")
  strip       inputs[] frames → one horizontal strip of frameW×frameH cells, feet on one baseline  ("frameW","frameH","baseline","align")
  layer       inputs[] frames + "bases"[] → diff each frame against its base, keep only new pixels, strip as above
  nineslice   inputs[0] source + "slice" inset + "cells" [w,h] → one 9-sliced frame of cells*64
  wheel-svg   inputs[0] rim texture (optional) + "labels"[] → SVG with <g id="segments"> and <g id="labels">
  svg-wrap    inputs[0] png → SVG of "size" embedding the image (pixelated when mode == pixel)
  audio       inputs[0] pcm/wav/mp3 → mono 16-bit WAV at "rate" (48000), normalised to "lufs" (−16)
"""
import io, json, math, os, struct, subprocess, sys, shutil, wave, base64

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

NEAREST = Image.NEAREST
LANCZOS = Image.LANCZOS

# ── optional tools ───────────────────────────────────────────────────
def have(mod):
    try:
        __import__(mod); return True
    except Exception:
        return False
HAVE_REMBG = have("rembg")
HAVE_LOUDNORM = have("pyloudnorm") and have("numpy")
HAVE_FFMPEG = shutil.which("ffmpeg") is not None

# ── image helpers ────────────────────────────────────────────────────
def load(p):
    return Image.open(p).convert("RGBA")

def chroma_key(im, color=(0, 255, 0), tol=70):
    """Make every pixel within `tol` (RGB distance) of `color` transparent. Prompts ask for a flat pure-green
    background so sets can be keyed deterministically without a model."""
    px = im.load(); w, h = im.size; cr, cg, cb = color
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2 <= tol * tol:
                px[x, y] = (r, g, b, 0)
    return im

def corner_key(im, tol=40):
    """Flood-fill transparency from the four corners over the near-uniform background colour found there."""
    w, h = im.size; px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    seen = bytearray(w * h); stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]: continue
        seen[y * w + x] = 1
        r, g, b, a = px[x, y]
        if (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2 > tol * tol: continue
        px[x, y] = (r, g, b, 0)
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im

def cutout(im, how):
    if how == "none": return im
    if how == "chroma": return chroma_key(im)
    if how == "corners": return corner_key(im)
    if how == "rembg" or how == "auto":
        if HAVE_REMBG:
            from rembg import remove, new_session
            model = os.environ.get("ART_REMBG_MODEL", "birefnet-general")
            try:
                sess = new_session(model)
            except Exception:
                sess = new_session("u2net")
            buf = io.BytesIO(); im.save(buf, "PNG")
            return Image.open(io.BytesIO(remove(buf.getvalue(), session=sess))).convert("RGBA")
        return corner_key(im) if how == "auto" else im
    return im

def trim(im, pad=0):
    bbox = im.getbbox()
    if not bbox: return im
    l, t, r, b = bbox
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))

def fit(im, size, mode, margin=0.0, anchor="center"):
    """Scale `im` to fit inside size minus margin, keeping aspect; nearest (integer factors when possible) for
    pixel art, Lanczos for painted; centred (or bottom-anchored) on a transparent canvas of `size`."""
    W, H = size
    tw, th = int(W * (1 - 2 * margin)), int(H * (1 - 2 * margin))
    if im.width == 0 or im.height == 0: return Image.new("RGBA", (W, H))
    s = min(tw / im.width, th / im.height)
    if mode == "pixel":
        s = math.floor(s) if s >= 1 else s  # integer upscale keeps pixels square
        if s < 1 and s > 0: s = 1 / math.ceil(1 / s)
    nw, nh = max(1, round(im.width * s)), max(1, round(im.height * s))
    im2 = im.resize((nw, nh), NEAREST if mode == "pixel" else LANCZOS)
    out = Image.new("RGBA", (W, H))
    x = (W - nw) // 2
    y = (H - nh) // 2 if anchor == "center" else H - nh - int(H * margin)
    out.paste(im2, (x, y), im2)
    return out

def quantize(im, colors=32):
    """Reduce to ≤ colors while keeping the alpha mask exact (Pillow's quantize blurs alpha)."""
    alpha = im.getchannel("A")
    rgb = im.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    rgb.putalpha(alpha.point(lambda a: 255 if a >= 128 else 0))
    return rgb

def harden_alpha(im, thresh=128):
    a = im.getchannel("A").point(lambda v: 255 if v >= thresh else 0)
    im.putalpha(a); return im

def save_png(im, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, "PNG", optimize=True)  # no tEXt chunks → not a placeholder

# ── ops ──────────────────────────────────────────────────────────────
def op_single(job):
    im = load(job["inputs"][0])
    im = cutout(im, job.get("cutout", "chroma" if job["mode"] == "pixel" else "auto"))
    if job.get("trim", True): im = trim(im)
    if job.get("pixelate"):
        # Output from a painterly model: bring it onto the pixel grid first (Lanczos down to genSize), then let
        # fit() upscale by an integer factor with nearest-neighbour so the pixels stay square.
        pw, ph = job["pixelate"]; s = min(pw / max(1, im.width), ph / max(1, im.height))
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), LANCZOS)
        im = harden_alpha(im)
    im = fit(im, job["size"], job["mode"], margin=job.get("margin", 0.0), anchor=job.get("anchor", "center"))
    if job["mode"] == "pixel":
        im = harden_alpha(im)
        if job.get("quantize", True): im = quantize(im, job.get("colors", 32))
    save_png(im, job["out"])
    return {"written": job["out"], "size": im.size}

def frame_fit(im, fw, fh, baseline, mode="pixel"):
    """Place a frame on a fw×fh cell: feet on `baseline` (y of the lowest opaque row), x-centred."""
    im = trim(im)
    if im.width > fw or im.height > fh:
        im = fit(im, (fw, fh), mode).crop(fit(im, (fw, fh), mode).getbbox() or (0, 0, fw, fh))
    out = Image.new("RGBA", (fw, fh))
    out.paste(im, ((fw - im.width) // 2, max(0, baseline - im.height)), im)
    return out

def op_strip(job, frames=None):
    fw, fh = job["frameW"], job["frameH"]
    frames = frames or [cutout(load(p), job.get("cutout", "chroma" if job["mode"] == "pixel" else "none")) for p in job["inputs"]]
    baseline = job.get("baseline", fh - 4)
    cells = [frame_fit(f, fw, fh, baseline) if job.get("align", True) else f.resize((fw, fh), NEAREST) for f in frames]
    strip = Image.new("RGBA", (fw * len(cells), fh))
    for i, c in enumerate(cells): strip.paste(c, (i * fw, 0), c)
    strip = harden_alpha(strip)
    if job.get("quantize", True): strip = quantize(strip, job.get("colors", 32))
    save_png(strip, job["out"])
    return {"written": job["out"], "frames": len(cells), "size": strip.size}

def diff_layer(gen, base, tol=24):
    """Pixels of `gen` that differ from `base` (same size) by more than tol, or that are opaque where base is
    transparent, survive; everything else becomes transparent. This is the SPEC's 'diff against the naked body'."""
    gen = gen.convert("RGBA"); base = base.convert("RGBA").resize(gen.size, NEAREST)
    gp, bp = gen.load(), base.load(); out = Image.new("RGBA", gen.size); op = out.load()
    for y in range(gen.height):
        for x in range(gen.width):
            r, g, b, a = gp[x, y]; r2, g2, b2, a2 = bp[x, y]
            if a < 128: continue
            if a2 < 128 or abs(r - r2) + abs(g - g2) + abs(b - b2) > tol: op[x, y] = (r, g, b, 255)
    return out

def op_layer(job):
    frames = []
    for p, bpath in zip(job["inputs"], job["bases"]):
        gen = load(p); base = load(bpath)
        if gen.size != base.size: gen = gen.resize(base.size, NEAREST)
        frames.append(diff_layer(gen, base, job.get("tol", 24)))
    job = dict(job); job["align"] = False; job["cutout"] = "none"
    return op_strip(job, frames)

def op_nineslice(job):
    src = load(job["inputs"][0]); inset = job.get("slice", 12); cw, ch = job["cells"]
    W, H = cw * 64, ch * 64
    # Source must be at least 3*inset in each direction; scale it to 64×64 cell units first.
    if src.size != (192, 192): src = src.resize((192, 192), LANCZOS if job["mode"] != "pixel" else NEAREST)
    s = 192; i = inset * 3  # the source is 3 cells of 64 → inset scales ×3
    parts = {
        "tl": src.crop((0, 0, i, i)), "t": src.crop((i, 0, s - i, i)), "tr": src.crop((s - i, 0, s, i)),
        "l": src.crop((0, i, i, s - i)), "c": src.crop((i, i, s - i, s - i)), "r": src.crop((s - i, i, s, s - i)),
        "bl": src.crop((0, s - i, i, s)), "b": src.crop((i, s - i, s - i, s)), "br": src.crop((s - i, s - i, s, s)),
    }
    k = inset  # final inset in px
    def rs(im, w, h): return im.resize((max(1, w), max(1, h)), NEAREST if job["mode"] == "pixel" else LANCZOS)
    out = Image.new("RGBA", (W, H))
    out.paste(rs(parts["tl"], k, k), (0, 0)); out.paste(rs(parts["tr"], k, k), (W - k, 0)); out.paste(rs(parts["bl"], k, k), (0, H - k)); out.paste(rs(parts["br"], k, k), (W - k, H - k))
    out.paste(rs(parts["t"], W - 2 * k, k), (k, 0)); out.paste(rs(parts["b"], W - 2 * k, k), (k, H - k)); out.paste(rs(parts["l"], k, H - 2 * k), (0, k)); out.paste(rs(parts["r"], k, H - 2 * k), (W - k, k))
    if job.get("fill_center", False): out.paste(rs(parts["c"], W - 2 * k, H - 2 * k), (k, k))
    save_png(out, job["out"])
    return {"written": job["out"], "size": out.size}

def png_data_uri(im):
    buf = io.BytesIO(); im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

def esc(s): return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def op_wheel_svg(job):
    """A painted rim, the hub, and N equal segments as unstyled paths the renderer relabels. Odds are never
    baked: packages/ui/wheel.js only inlines this face when every segment weighs the same."""
    labels = job.get("labels", []); n = max(1, len(labels)); W = H = 1024; cx = cy = 512; R = 480
    rim = ""
    if job.get("inputs"):
        im = load(job["inputs"][0]).resize((1024, 1024), LANCZOS)
        rim = f'<image id="rim-texture" href="{png_data_uri(im)}" x="0" y="0" width="1024" height="1024"/>'
    segs, labs = [], []
    for i in range(n):
        a0 = -180 / n + i * 360 / n; a1 = a0 + 360 / n; mid = (a0 + a1) / 2
        def pt(deg, r):
            a = math.radians(deg - 90); return (cx + r * math.cos(a), cy + r * math.sin(a))
        x0, y0 = pt(a0, R); x1, y1 = pt(a1, R)
        d = f"M{cx},{cy} L{x0:.1f},{y0:.1f} A{R},{R} 0 {1 if 360 / n > 180 else 0},1 {x1:.1f},{y1:.1f} Z"
        segs.append(f'<path d="{d}" data-index="{i}"/>')
        lx, ly = pt(mid, R * 0.68)
        labs.append(f'<text x="{lx:.1f}" y="{ly:.1f}" transform="rotate({mid:.1f} {lx:.1f} {ly:.1f})" text-anchor="middle" dominant-baseline="middle" data-index="{i}">{esc(labels[i])}</text>')
    svg = (f'<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n'
           f'<defs><clipPath id="face"><circle cx="{cx}" cy="{cy}" r="{R}"/></clipPath></defs>\n'
           f'<g id="rim">{rim}<circle cx="{cx}" cy="{cy}" r="{R + 20}" fill="none" stroke="#9c7a2e" stroke-width="10"/></g>\n'
           f'<g id="segments" clip-path="url(#face)">{"".join(segs)}</g>\n<g id="labels" font-family="Cinzel, serif" font-size="34" fill="#e8dfc8">{"".join(labs)}</g>\n'
           f'<g id="hub"><circle cx="{cx}" cy="{cy}" r="70" fill="#17111a" stroke="#c9a24a" stroke-width="8"/></g>\n</svg>\n')
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    with open(job["out"], "w", encoding="utf-8") as f: f.write(svg)
    return {"written": job["out"], "segments": n}

def op_svg_wrap(job):
    W, H = job["size"]; im = load(job["inputs"][0])
    im = cutout(im, job.get("cutout", "chroma" if job["mode"] == "pixel" else "none"))
    if job.get("trim", False): im = trim(im)
    if job["mode"] == "pixel":
        gw, gh = job.get("pixelate") or job.get("genSize") or [W, H]
        if im.size != (gw, gh): im = im.resize((gw, gh), LANCZOS if job.get("pixelate") else NEAREST)
        im = quantize(harden_alpha(im), job.get("colors", 32))
    else:
        im = im.resize((W, H), LANCZOS)
    render = ' style="image-rendering: pixelated"' if job["mode"] == "pixel" else ""
    svg = (f'<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n'
           f'<image href="{png_data_uri(im)}" x="0" y="0" width="{W}" height="{H}" preserveAspectRatio="xMidYMid meet"{render}/>\n</svg>\n')
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    with open(job["out"], "w", encoding="utf-8") as f: f.write(svg)
    return {"written": job["out"]}

# ── audio ────────────────────────────────────────────────────────────
def read_audio(p, fmt):
    """→ (samples as list of float mono, rate). Accepts raw s16le PCM (fmt 'pcm_s16le_44100_mono'), WAV, or anything ffmpeg decodes."""
    if fmt.startswith("pcm"):
        rate = int(fmt.split("_")[2]) if "_" in fmt else 44100
        raw = open(p, "rb").read(); n = len(raw) // 2
        return [struct.unpack_from("<h", raw, i * 2)[0] / 32768.0 for i in range(n)], rate
    if p.lower().endswith(".wav"):
        with wave.open(p, "rb") as w:
            ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes(); raw = w.readframes(n)
        if sw == 2:
            vals = struct.unpack("<%dh" % (len(raw) // 2), raw); scale = 32768.0
        elif sw == 4:
            vals = struct.unpack("<%di" % (len(raw) // 4), raw); scale = 2147483648.0
        elif sw == 1:
            vals = [v - 128 for v in raw]; scale = 128.0
        else:
            raise SystemExit("unsupported WAV sample width")
        mono = [sum(vals[i:i + ch]) / ch / scale for i in range(0, len(vals), ch)]
        return mono, rate
    if HAVE_FFMPEG:
        out = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], capture_output=True, check=True).stdout
        return [struct.unpack_from("<h", out, i * 2)[0] / 32768.0 for i in range(len(out) // 2)], 48000
    raise SystemExit(f"cannot decode {p}: install ffmpeg")

def resample(samples, src, dst):
    if src == dst: return samples
    n = int(len(samples) * dst / src); out = []
    for i in range(n):
        x = i * src / dst; j = int(x); t = x - j
        a = samples[min(j, len(samples) - 1)]; b = samples[min(j + 1, len(samples) - 1)]
        out.append(a + (b - a) * t)
    return out

def normalise(samples, rate, lufs=-16.0):
    if HAVE_LOUDNORM:
        import numpy as np, pyloudnorm as pyln
        arr = np.array(samples, dtype=np.float64)
        if len(arr) >= rate * 0.4:
            meter = pyln.Meter(rate); loud = meter.integrated_loudness(arr)
            if math.isfinite(loud): arr = pyln.normalize.loudness(arr, loud, lufs)
            peak = float(np.max(np.abs(arr))) or 1.0
            if peak > 0.98: arr = arr * (0.98 / peak)
            return arr.tolist()
    rms = math.sqrt(sum(v * v for v in samples) / max(1, len(samples))) or 1e-9
    gain = (10 ** (lufs / 20)) / rms
    peak = max(abs(v) for v in samples) or 1e-9
    gain = min(gain, 0.98 / peak)
    return [v * gain for v in samples]

def op_audio(job):
    samples, rate = read_audio(job["inputs"][0], job.get("format", "wav"))
    dst = job.get("rate", 48000)
    samples = resample(samples, rate, dst)
    # trim leading/trailing silence for cues (not music), small fades
    if not job.get("music", False):
        thr = 0.004; s = 0; e = len(samples)
        while s < e and abs(samples[s]) < thr: s += 1
        while e > s and abs(samples[e - 1]) < thr: e -= 1
        samples = samples[max(0, s - dst // 200):min(len(samples), e + dst // 50)] or samples
    samples = normalise(samples, dst, job.get("lufs", -16.0))
    fade = min(len(samples) // 2, int(dst * (0.5 if job.get("music") else 0.005)))
    for i in range(fade):
        g = i / fade; samples[i] *= g; samples[-1 - i] *= g
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    with wave.open(job["out"], "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(dst)
        w.writeframes(struct.pack("<%dh" % len(samples), *[max(-32768, min(32767, int(v * 32767))) for v in samples]))
    return {"written": job["out"], "seconds": round(len(samples) / dst, 3), "rate": dst}

OPS = {"single": op_single, "strip": op_strip, "layer": op_layer, "nineslice": op_nineslice, "wheel-svg": op_wheel_svg, "svg-wrap": op_svg_wrap, "audio": op_audio}

def main(argv):
    if len(argv) < 2: sys.exit(__doc__)
    cmd = argv[1]
    if cmd == "check":
        print(json.dumps({"pillow": True, "rembg": HAVE_REMBG, "pyloudnorm": HAVE_LOUDNORM, "ffmpeg": HAVE_FFMPEG})); return
    if cmd == "rgba":
        im = load(argv[2]); w, h = im.size
        with open(argv[3], "wb") as f: f.write(struct.pack("<II", w, h)); f.write(im.tobytes())
        return
    if cmd == "process":
        job = json.load(open(argv[2], encoding="utf-8"))
        res = OPS[job["op"]](job)
        print(json.dumps(res)); return
    sys.exit(f"unknown command {cmd}")

if __name__ == "__main__":
    main(sys.argv)
