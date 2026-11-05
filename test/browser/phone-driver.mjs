// Drives a phone through its turn by tapping the real screens: shared by the browser gate (run.mjs) and the
// per-mode gate (modes.mjs). Everything here reads the phone's own state through window.__gwf.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function clickWhen(page, sel, msg = '', timeout = 15000) {
  const loc = (typeof sel === 'string' ? page.locator(sel) : sel).first();
  try { await loc.click({ timeout }); }
  catch (e) { if (!/Timeout|intercepts pointer events/.test(e.message)) throw e; await loc.waitFor({ state: 'visible', timeout: 5000 }); await loc.evaluate(el => el.click()); console.log('  · (DOM click after a pointer timeout)'); }
  if (msg) console.log('  ·', msg);
}

// What the mover's phone is looking at, as data.
export const turnView = (ph) => ph.evaluate(() => {
  const s = window.__gwf.session.state, me = window.__gwf.ctx.me;
  const c = Object.values(s.characters).find(x => x.playerId === me) || null;
  const ms = s.moveSession && s.moveSession.playerId === me && !s.moveSession.done ? s.moveSession : null;
  const f = s.fight && !s.fight.done ? s.fight : null, ch = s.challenge && !s.challenge.done ? s.challenge : null;
  return { me, phase: s.phase, mover: s.moverId, turnIdx: s.turnIdx, turnPhase: s.turnPhase, pos: c?.pos || null, dead: !!c?.dead, moved: !!c?.usedThisTurn?.moved, hatching: !!c?.hatching,
    prompt: s.pendingPrompt && (s.pendingPrompt.playerId === me || s.pendingPrompt.targetId === me) ? { kind: s.pendingPrompt.kind, mine: s.pendingPrompt.playerId === me, source: s.pendingPrompt.source || null } : null,
    fight: f ? { playerId: f.playerId, turn: f.turn, game: !!(f.game && !f.game.result), kind: f.kind } : null,
    session: ms ? { movesLeft: ms.movesLeft, stepsTaken: ms.stepsTaken, atomic: !!ms.atomic, awaiting: ms.awaiting || null } : null,
    challenge: !!(ch && (ch.attackerId === me || ch.defenderId === me)), held: !!s.held[me] && !s.held[me].owedWait, lastError: s.lastError && Date.now() - s.lastError.ts < 3000 ? `${s.lastError.type}: ${s.lastError.message}` : null };
});
export async function answerPrompt(ph, pr) {
  if (pr.kind === 'spin') return clickWhen(ph, '.prompt button.primary.big:has-text("Spin")', 'spins the tile wheel');
  if (pr.kind === 'portal') { const stay = ph.locator('.prompt button:has-text("Stay here")'); if (await stay.count()) return clickWhen(ph, stay, 'stays off the portal'); return clickWhen(ph, '.prompt .col button', 'takes the portal'); }
  if (pr.kind === 'arena') return clickWhen(ph, '.prompt button:has-text("Walk on")', 'walks past the Arena');
  if (pr.kind === 'takeWorn') return clickWhen(ph, '.prompt button:has-text("Take nothing")', 'takes nothing from the fallen');
  if (pr.kind === 'callout') { const b = ph.locator('.prompt button:has-text("Noted")'); if (await b.count()) return b.first().click(); return sleep(300); }
  return sleep(300);
}
// Click through whatever minigame controls are showing (Accept first, then the primary button, then any button).
export async function playRoundButtons(ph) {
  const accept = ph.locator('.mg-buttons button:has-text("Accept")');
  if (await accept.count()) return accept.first().click();
  const primary = ph.locator('.mg-buttons button.primary:not([disabled])');
  if (await primary.count()) return primary.first().click();
  const any = ph.locator('.mg-buttons button:not([disabled]), .mg-grid button:not([disabled])');
  if (await any.count()) return any.first().click();
  return sleep(300);
}
// Play the mover's turn from their phone by clicking the real screens until the turn ends (or a challenge /
// the end of the run takes over). Monster hexes are avoided unless asked for.
export async function playTurn(ph, { label = 'turn', timeoutMs = 60000, avoidMonsters = true } = {}) {
  const t0 = Date.now(); let idle = 0, last = null;
  while (Date.now() - t0 < timeoutMs) {
    const v = last = await turnView(ph);
    if (v.phase !== 'playing') return v;
    if (v.hatching) { await clickWhen(ph, '.pet-wheel', `${label}: keeps a pet from the Triple Pet Wheel`); await sleep(250); continue; }
    if (v.challenge) return v;
    if (v.mover !== v.me) return v;
    if (v.prompt && v.prompt.mine) { await answerPrompt(ph, v.prompt); await sleep(300); continue; }
    if (v.fight && v.fight.playerId === v.me) {
      if (v.fight.turn === 'monster') { await sleep(300); continue; }
      if (v.fight.game) { await playRoundButtons(ph); await sleep(300); continue; }
      const back = ph.locator('button:has-text("Back away")').first();
      if (await back.isEnabled().catch(() => false)) await back.click(); else await clickWhen(ph, 'button:has-text("End turn")');
      await sleep(300); continue;
    }
    if (v.dead) { await clickWhen(ph, 'button:has-text("Pass")', `${label}: passes (dead)`); await sleep(300); continue; }
    if (v.turnPhase === 'move') {
      if (!v.session) {
        if (v.moved) { await clickWhen(ph, 'button:has-text("End turn")'); await sleep(300); continue; }
        await clickWhen(ph, '.prompt button.primary.big', '', 8000);   // Plod / Roll / Spin / Draw / a mode
        await sleep(300); continue;
      }
      if (v.session.atomic) { await clickWhen(ph, '.btn-grid button.primary', 'jumps to a lit hex'); await sleep(300); continue; }
      await ph.locator('.rosette').first().waitFor({ timeout: 8000 });
      const steps = ph.locator(avoidMonsters ? '.rosette .hexbtn.ok:not(.hot)' : '.rosette .hexbtn.ok');
      const hub = ph.locator('.rosette .hub:not([disabled])');
      const n = await steps.count();
      if (v.session.movesLeft > 0 && n) await steps.nth((v.turnIdx + v.session.stepsTaken) % n).click();   // vary the direction turn by turn
      else if (await hub.count()) await hub.first().click();
      else if (await ph.locator('.rosette .hexbtn.ok').count()) await ph.locator('.rosette .hexbtn.ok').first().click();
      else await sleep(300);
      await sleep(300); continue;
    }
    if (v.turnPhase === 'resolve') { if (++idle > 25) await clickWhen(ph, 'button:has-text("End turn anyway")'); else await sleep(300); continue; }
    await clickWhen(ph, 'button.end-turn'); await sleep(300);
    return { ...v, ended: true };
  }
  throw new Error(`${label}: playTurn timed out at ${JSON.stringify(last)}`);
}
