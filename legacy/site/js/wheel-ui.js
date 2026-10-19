// Shared wheel overlay renderer. Both windows show the same spin.
// Usage: showWheelSpin(overlayEl, {wheel, outcomes[], index}) → resolves when done.
const PALETTE = ['#c0392b','#2f6db3','#3f9d5c','#d4ac0d','#8e44ad','#e67e22','#16a085','#7f8c8d','#c2185b','#5d4037','#455a64','#33691e'];

export function showWheelSpin(overlay, spin, { onDone } = {}) {
  const n = spin.outcomes.length;
  const seg = 360 / n;
  overlay.innerHTML = `
    <div class="wheel-title">${esc(spin.wheel)}</div>
    <div class="wheel-wrap">
      <div class="wheel-pointer"></div>
      <svg class="wheel-svg" viewBox="-110 -110 220 220">${segments(spin.outcomes, seg, spin.colors)}</svg>
    </div>
    <div class="wheel-result"></div>`;
  overlay.classList.add('show');
  const svg = overlay.querySelector('.wheel-svg');
  const resultEl = overlay.querySelector('.wheel-result');
  // Pointer at top (−90°). Segment i center angle = i*seg + seg/2 − 90 (svg
  // coords, clockwise). Rotating by θ moves a point at angle a to a+θ, so to
  // put the chosen center under the pointer: θ = −90 − (i*seg + seg/2 − 90)
  // = 360 − (i*seg + seg/2) (mod 360), plus full turns and a little jitter.
  const target = 5 * 360 + (360 - (spin.index * seg + seg / 2)) + (Math.random() * seg * 0.6 - seg * 0.3);
  svg.style.transform = 'rotate(0deg)';
  // Commit the starting angle with a forced reflow, then set the target so the
  // CSS transition animates between them. No requestAnimationFrame here: rAF
  // never fires in hidden/background tabs, which froze the wheel at 0° with
  // the pointer parked on the last segment's seam.
  void svg.getBoundingClientRect();
  svg.style.transform = `rotate(${target}deg)`;
  setTimeout(() => {
    // Result label + a big unmissable banner saying what it actually DID
    resultEl.innerHTML = `<div>${esc(spin.outcomes[spin.index])}</div>` +
      (spin.effect ? `<div class="wheel-effect">${esc(spin.effect)}</div>` : '');
  }, 4300);
  // No auto-hide: the wheel stays on screen until the GM's next action clears
  // it (see view.js), or someone clicks the overlay.
  overlay.onclick = () => { overlay.classList.remove('show'); onDone && onDone(); };
}

function segments(outcomes, seg, colors) {
  let s = '';
  const n = outcomes.length;
  const fontSize = n > 24 ? 5 : n > 10 ? 6.2 : 7.5;
  outcomes.forEach((label, i) => {
    const a0 = (i * seg - 90) * Math.PI / 180;
    const a1 = ((i + 1) * seg - 90) * Math.PI / 180;
    const large = seg > 180 ? 1 : 0;
    const x0 = Math.cos(a0) * 100, y0 = Math.sin(a0) * 100;
    const x1 = Math.cos(a1) * 100, y1 = Math.sin(a1) * 100;
    const fill = (colors && colors[i]) || PALETTE[i % PALETTE.length];
    s += `<path d="M0,0 L${x0.toFixed(2)},${y0.toFixed(2)} A100,100 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z"
           fill="${fill}" stroke="#00000055" stroke-width="${n > 24 ? 0.5 : 1}"/>`;
    const mid = (i + 0.5) * seg - 90;
    const short = label.length > 16 ? label.slice(0, 15) + '…' : label;
    s += `<text x="97" y="0" transform="rotate(${mid}) " text-anchor="end" dominant-baseline="middle"
           font-size="${fontSize}" fill="#fff" font-weight="700">${esc(short)}</text>`;
  });
  s += `<circle cx="0" cy="0" r="14" fill="#111" stroke="#fff" stroke-width="2"/>`;
  return s;
}

// Full-screen splash (no wheel) — used for CHAOS shuffles and the like.
export function showSplash(overlay, title, sub, { onDone } = {}) {
  overlay.innerHTML = `<div class="wheel-title">${esc(title)}</div>
    <div class="wheel-result"><div class="wheel-effect">${esc(sub || '')}</div></div>`;
  overlay.classList.add('show');
  overlay.onclick = () => { overlay.classList.remove('show'); onDone && onDone(); };
}

export function esc(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
