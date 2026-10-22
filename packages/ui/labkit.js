// Browser-side kit shared by the Game Lab and the GM console's Monsters panel. No node imports.
//   ensureStageCss()                  the legacy stage classes (pcard, mine-grid, keno-grid …) mapped onto the theme tokens
//   renderControls(el, controls, act) the adapter's controls-as-data → buttons / inputs / grid (60 px targets in phone mode)
//   mountRound({...})                 drive one adapter Round in the page: controls, live stage, ticks, auto-settle, power-ups
//   closedFormReturns(gameId)         the legacy closed-form RTP rows for the 36 games (where the maths allows)
//   wheelSvg({outcomes, index})       a small SVG wheel that lands on `index`
//   makeSandbox({seed, classId})      an in-memory room (reducer only, no backend) with one tester in the 'playing' phase
//   runGame(opts, onProgress)         tools/bots.mjs › runGame ported to the browser (async, yields to the UI)
//   curveSvg(curve)                   the bot run's Health curve as a small SVG
import '../shared/index.js';
import { applyEvent } from '../shared/reducer.js';
import { makeEvent } from '../shared/events.js';
import { makeRng } from '../shared/rng.js';
import { currentPlayerId, characterOf } from '../shared/state.js';
import { nextAction, tableDuties } from '../shared/bot.js';
import { readyToSettle } from '../games/lab-core.js';
import { baseOdds } from '../games/adapter.js';
import * as G from '../games/legacy/games.js';
import { EXTRA } from '../games/legacy/games-extra.js';
import { group } from '../shared/balance.js';
import { esc } from './dom.js';
import { arcs } from './wheel.js';

// ── stage CSS ────────────────────────────────────────────────────────────────────────────────────
// legacy/site/css/app.css › game stage, ported: the legacy token names are defined on .gwf-stage from the theme.
export const STAGE_CSS = `
.gwf-stage { --ink: var(--bone); --ink-dim: var(--bone-dim); --accent: var(--gold); --accent-2: var(--oxblood-2); --good: var(--ok); --good-ink: #9fd49a; --bad: var(--blood); --bad-ink: #f2b3b3; --bg-raised: var(--panel-2); --bg-panel: var(--panel); --border: var(--line-2); --font: var(--font-display); --font-ui: var(--font-body);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 18px; min-height: 260px; min-width: 0; max-width: 100%; background: radial-gradient(600px 300px at 50% 0%, #241a17, var(--velvet-2)); border: 1px solid var(--line-2); border-radius: var(--radius); overflow: auto; }
.gwf-stage > * { max-width: 100%; min-width: 0; }
.gwf-stage .stage-head { font-family: var(--font); font-size: clamp(18px, 2.4vw, 30px); color: var(--accent); text-transform: uppercase; letter-spacing: .08em; }
.gwf-stage .stage-sub { font-size: clamp(14px, 1.4vw, 18px); color: var(--ink-dim); }
.gwf-stage .stage-big { font-family: var(--font); font-size: clamp(28px, 4.6vw, 64px); font-weight: 700; color: var(--ink); line-height: 1.1; }
.gwf-stage .stage-big.small { font-size: clamp(20px, 3vw, 40px); }
.gwf-stage .crash-live, .gwf-stage .crash-good { color: var(--good-ink); } .gwf-stage .crash-bad { color: var(--bad-ink); }
.gwf-stage .crash-svg { width: min(70vw, 620px, 100%); height: 160px; background: rgba(0,0,0,.25); border-radius: 10px; }
.gwf-stage .roulette-red { color: var(--bad-ink); } .gwf-stage .roulette-black { color: var(--ink); } .gwf-stage .roulette-green { color: var(--good-ink); }
.gwf-stage .mine-grid { display: grid; gap: 6px; width: min(56vh, 400px, 100%); }
.gwf-stage .mine-cell { aspect-ratio: 1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 2vw, 26px); border: 2px solid var(--border); background: var(--bg-raised); color: var(--ink); }
.gwf-stage .mine-cell .mine-num { font-size: clamp(12px, 1.4vw, 18px); color: var(--ink-dim); font-weight: 700; }
.gwf-stage .mine-cell.hidden { background: color-mix(in srgb, var(--accent) 8%, var(--bg-raised)); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.gwf-stage .mine-cell.safe { background: color-mix(in srgb, var(--good) 45%, var(--bg-raised)); border-color: var(--good); }
.gwf-stage .mine-cell.mine { background: color-mix(in srgb, var(--bad) 35%, var(--bg-raised)); border-color: var(--bad); }
.gwf-stage .mine-cell.mine.hit { background: var(--bad); }
.gwf-stage .card-table { display: flex; flex-direction: column; gap: clamp(8px, 1.6vh, 18px); align-items: center; }
.gwf-stage .card-table.side-by-side { flex-direction: row; gap: clamp(16px, 4vw, 60px); align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.gwf-stage .hand { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 14px; border: 2px solid transparent; }
.gwf-stage .hand.winner { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.gwf-stage .hand-label { font-family: var(--font); text-transform: uppercase; letter-spacing: .1em; color: var(--ink-dim); font-size: clamp(12px, 1.3vw, 18px); min-height: 1.3em; }
.gwf-stage .hand-label b { color: var(--ink); font-size: 1.35em; margin-left: 6px; }
.gwf-stage .hand-label .chip { background: var(--accent); color: #111; border-radius: 999px; padding: 1px 10px; font-size: .7em; font-weight: 800; letter-spacing: .05em; }
.gwf-stage .hands-row { display: flex; gap: clamp(8px, 2vw, 30px); align-items: flex-start; justify-content: center; flex-wrap: wrap; }
.gwf-stage .hand-result { font-size: clamp(12px, 1.3vw, 16px); font-weight: 700; max-width: 16em; }
.gwf-stage .pcard-row { display: flex; gap: clamp(5px, .7vw, 10px); min-height: clamp(70px, 11vh, 120px); flex-wrap: wrap; justify-content: center; }
.gwf-stage .pcard { width: clamp(48px, 7.6vh, 84px); height: clamp(70px, 11vh, 120px); border-radius: 10px; background: #fbf8f1; color: #16181d; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; box-shadow: 0 4px 14px rgba(0,0,0,.45); border: 1px solid #cfc8b8; }
.gwf-stage .pcard.new { animation: gwf-card-in .28s ease-out; }
.gwf-stage .pcard.red { color: #c0262d; }
.gwf-stage .pcard .pc-r { font-family: var(--font); font-weight: 700; font-size: clamp(20px, 3.4vh, 38px); }
.gwf-stage .pcard .pc-s { font-size: clamp(18px, 3vh, 32px); margin-top: 2px; }
.gwf-stage .pcard.back { background: repeating-linear-gradient(45deg, var(--accent-2) 0 7px, color-mix(in srgb, var(--accent-2) 65%, black) 7px 14px); border: 3px solid #fbf8f1; }
.gwf-stage .pcard.ghost { background: transparent; border: 2px dashed var(--border); box-shadow: none; }
.gwf-stage .hilo-trail .pcard:not(:last-child) { opacity: .45; transform: scale(.82); }
.gwf-stage .plinko-svg { width: min(74vw, 100%); max-height: 48vh; }
.gwf-stage .plk-peg { fill: var(--ink-dim); } .gwf-stage .plk-ball { fill: var(--accent); stroke: #fff; stroke-width: 1.5; }
.gwf-stage .plk-slot rect { fill: var(--bg-raised); stroke: var(--border); stroke-width: 1; } .gwf-stage .plk-slot text { fill: var(--ink); font-size: 9px; font-weight: 800; font-family: var(--font-ui); }
.gwf-stage .plk-slot.hot rect { fill: color-mix(in srgb, var(--bad) 70%, var(--bg-raised)); } .gwf-stage .plk-slot.warm rect { fill: color-mix(in srgb, var(--accent) 55%, var(--bg-raised)); } .gwf-stage .plk-slot.even rect { fill: color-mix(in srgb, var(--good) 40%, var(--bg-raised)); }
.gwf-stage .plk-slot.hit rect { stroke: #fff; stroke-width: 2.5; } .gwf-stage .plk-slot.hot text, .gwf-stage .plk-slot.warm text { fill: #111; }
.gwf-stage .dice-face { font-family: var(--font); font-weight: 700; font-size: clamp(48px, 10vh, 120px); line-height: 1; min-width: 2.2em; text-align: center; padding: 10px 26px; border-radius: 22px; background: var(--bg-raised); border: 3px solid var(--border); color: var(--ink); }
.gwf-stage .dice-face.win { border-color: var(--good); color: var(--good-ink); } .gwf-stage .dice-face.lose { border-color: var(--bad); color: var(--bad-ink); }
.gwf-stage .dice-bar { position: relative; width: min(70vw, 560px, 100%); height: 22px; border-radius: 999px; background: color-mix(in srgb, var(--bad) 45%, var(--bg-raised)); overflow: hidden; }
.gwf-stage .dice-win { position: absolute; top: 0; bottom: 0; background: var(--good); } .gwf-stage .dice-mark { position: absolute; top: -4px; bottom: -4px; width: 5px; background: #fff; box-shadow: 0 0 8px #fff; }
.gwf-stage .dice-scale { width: min(70vw, 560px, 100%); display: flex; justify-content: space-between; color: var(--ink-dim); font-size: 13px; }
.gwf-stage .slot-machine { display: flex; gap: clamp(8px, 1.4vw, 20px); padding: clamp(10px, 2vh, 22px); border-radius: 22px; background: linear-gradient(180deg, var(--accent-2), color-mix(in srgb, var(--accent-2) 55%, black)); border: 4px solid var(--accent); }
.gwf-stage .slot-machine.win { box-shadow: 0 0 40px var(--accent); }
.gwf-stage .slot-reel { width: clamp(64px, 14vh, 150px); height: clamp(80px, 17vh, 180px); border-radius: 14px; background: #fbf8f1; display: flex; align-items: center; justify-content: center; font-size: clamp(40px, 9vh, 100px); line-height: 1; box-shadow: inset 0 10px 18px rgba(0,0,0,.28), inset 0 -10px 18px rgba(0,0,0,.28); }
.gwf-stage .slot-reel.spinning { filter: blur(1.6px); } .gwf-stage .slot-reel.idle { color: #999; }
.gwf-stage .keno-grid { display: grid; gap: 5px; width: min(66vh, 560px, 100%); }
.gwf-stage .keno-cell { aspect-ratio: 1.25; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: clamp(12px, 2vh, 22px); background: var(--bg-raised); border: 2px solid var(--border); color: var(--ink-dim); }
.gwf-stage .keno-cell.picked { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, var(--bg-raised)); }
.gwf-stage .keno-cell.drawn { background: color-mix(in srgb, var(--bad) 35%, var(--bg-raised)); border-color: var(--bad); color: var(--ink); }
.gwf-stage .keno-cell.hit { background: var(--good); border-color: #fff; color: #fff; box-shadow: 0 0 14px var(--good); }
.gwf-stage .keno-pays { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; min-height: 1.6em; }
.gwf-stage .keno-pay { font-size: clamp(12px, 1.2vw, 15px); padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--ink-dim); }
.gwf-stage .keno-pay.on { border-color: var(--accent); color: #111; background: var(--accent); font-weight: 800; }
.gwf-stage .xinfo { align-items: center; gap: 8px; } .gwf-stage .xbtns { flex-wrap: wrap; }
.gwf-stage .xnum { font-family: var(--font); font-size: 1.5em; color: var(--ink); }
.gwf-stage .xdice { display: flex; gap: clamp(10px, 2vw, 28px); justify-content: center; font-size: clamp(48px, 11vh, 120px); line-height: 1; color: var(--ink); }
.gwf-stage .xdice.rolling { color: var(--ink-dim); } .gwf-stage .xdice.rolling span { animation: gwf-shake .18s linear infinite; }
.gwf-stage .xtrail { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; min-height: 1.9em; }
.gwf-stage .xpill { display: inline-block; padding: 2px 12px; border-radius: 999px; background: var(--bg-raised); border: 1px solid var(--border); color: var(--ink); font-weight: 700; font-size: clamp(13px, 1.4vw, 18px); }
.gwf-stage .xpill.ok { border-color: var(--good); color: var(--good-ink); } .gwf-stage .xpill.no { border-color: var(--bad); color: var(--bad-ink); }
.gwf-stage .xpill.now { border-color: var(--accent); color: var(--accent); } .gwf-stage .xpill.gone { opacity: .3; text-decoration: line-through; }
.gwf-stage .xcoin { font-size: clamp(56px, 13vh, 140px); line-height: 1; } .gwf-stage .xcoin.flipping { animation: gwf-flip .3s linear infinite; }
.gwf-stage .xbetween { display: flex; gap: clamp(10px, 2vw, 30px); align-items: center; justify-content: center; flex-wrap: wrap; }
.gwf-stage .xgrid { display: grid; gap: clamp(6px, 1vw, 12px); justify-content: center; }
.gwf-stage .xgrid.three { grid-template-columns: repeat(3, clamp(60px, 10vh, 110px)); } .gwf-stage .xgrid.five { grid-template-columns: repeat(5, clamp(48px, 8vh, 90px)); }
.gwf-stage .xcell { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 12px; background: var(--bg-raised); border: 2px solid var(--border); font-size: clamp(26px, 5vh, 54px); color: var(--ink); line-height: 1; }
.gwf-stage .xcell.small { font-size: clamp(16px, 2.6vh, 26px); font-weight: 800; } .gwf-stage .xcell small { font-size: .5em; color: var(--ink-dim); }
.gwf-stage .xcell.hidden { color: var(--ink-dim); } .gwf-stage .xcell.hit { border-color: var(--good); background: color-mix(in srgb, var(--good) 22%, var(--bg-raised)); }
.gwf-stage .xcell.bad { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 25%, var(--bg-raised)); } .gwf-stage .xcell.dim { opacity: .45; } .gwf-stage .xcell.next { border-color: var(--accent); }
.gwf-stage .xrace { display: flex; flex-direction: column; gap: 6px; width: min(100%, 800px); }
.gwf-stage .xlane { display: grid; grid-template-columns: minmax(90px, 22%) 1fr; gap: 10px; align-items: center; text-align: left; }
.gwf-stage .xlane-name { font-weight: 700; color: var(--ink-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .gwf-stage .xlane-name small { color: var(--accent); margin-left: 4px; }
.gwf-stage .xlane.mine .xlane-name { color: var(--ink); } .gwf-stage .xlane.mine .xtrack { border-color: var(--accent); } .gwf-stage .xlane.won .xtrack { background: color-mix(in srgb, var(--good) 22%, transparent); }
.gwf-stage .xtrack { position: relative; height: clamp(30px, 5vh, 50px); border: 1px dashed var(--border); border-right: 4px double var(--ink); border-radius: 8px; }
.gwf-stage .xrunner { position: absolute; top: 50%; transform: translateY(-50%) scaleX(-1); font-size: clamp(22px, 4vh, 40px); line-height: 1; }
.gwf-stage .xtower { display: flex; flex-direction: column; gap: 5px; align-items: center; }
.gwf-stage .xfloor { display: flex; gap: 6px; align-items: center; } .gwf-stage .xfloor .xcell { width: clamp(30px, 4.6vh, 50px); }
.gwf-stage .xfloor-n { width: 4.6em; text-align: right; color: var(--ink-dim); font-weight: 700; font-size: clamp(11px, 1.3vw, 15px); margin-right: 4px; white-space: nowrap; }
.gwf-stage .xroads { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px; width: min(100%, 900px); }
.gwf-stage .xroad { min-height: clamp(70px, 12vh, 120px); border-radius: 8px; background: var(--bg-raised); border: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 6px 1px; min-width: 0; }
.gwf-stage .xroad.kerb { background: transparent; border-style: dashed; } .gwf-stage .xroad.done { border-color: var(--good); }
.gwf-stage .xroad-m { font-size: clamp(10px, 1vw, 14px); font-weight: 700; color: var(--ink-dim); white-space: nowrap; } .gwf-stage .xroad-c { font-size: clamp(20px, 4vh, 40px); line-height: 1; min-height: 1em; }
.gwf-stage .xpach { width: min(100%, 480px); max-height: 34vh; } .gwf-stage .xpeg { fill: var(--ink-dim); } .gwf-stage .xball { fill: var(--accent); }
.gwf-stage .xslots { display: grid; gap: 4px; width: min(100%, 480px); }
.gwf-stage .xslot { padding: 4px 0; border-radius: 6px; background: var(--bg-raised); border: 1px solid var(--border); font-weight: 800; font-size: clamp(12px, 1.3vw, 16px); color: var(--ink); display: flex; flex-direction: column; }
.gwf-stage .xslot.lit { border-color: var(--accent); } .gwf-stage .xslot b { color: var(--accent); font-size: .7em; letter-spacing: 1px; }
.gwf-stage .xcups { display: flex; gap: clamp(18px, 4vw, 60px); justify-content: center; align-items: flex-end; padding-top: clamp(26px, 5vh, 50px); }
.gwf-stage .xcup { display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; }
.gwf-stage .xcup-c { display: block; width: clamp(56px, 10vh, 100px); height: clamp(68px, 12vh, 120px); background: linear-gradient(160deg, var(--accent), color-mix(in srgb, var(--accent) 55%, black)); clip-path: polygon(22% 0, 78% 0, 100% 100%, 0 100%); border-radius: 10px 10px 4px 4px; transition: transform .25s ease-out; position: relative; z-index: 1; }
.gwf-stage .xcup.up .xcup-c { transform: translateY(-46%) rotate(-8deg); } .gwf-stage .xcup.picked small { color: var(--accent); }
.gwf-stage .xcup-b { position: absolute; bottom: 1.7em; font-size: clamp(18px, 3vh, 30px); line-height: 1; } .gwf-stage .xcup small { color: var(--ink-dim); font-weight: 800; font-size: clamp(12px, 1.3vw, 16px); }
.gwf-stage .xcup.mix.m0 { animation: gwf-mix-a .5s ease-in-out 3; } .gwf-stage .xcup.mix.m1 { animation: gwf-mix-b .5s ease-in-out 3; } .gwf-stage .xcup.mix.m2 { animation: gwf-mix-c .5s ease-in-out 3; }
.gwf-stage .xholds { display: grid; grid-template-columns: repeat(5, clamp(48px, 7.6vh, 84px)); gap: clamp(5px, .7vw, 10px); justify-content: center; min-height: 1.4em; }
.gwf-stage .xholds span { text-align: center; font-weight: 800; font-size: 12px; letter-spacing: .1em; color: transparent; } .gwf-stage .xholds span.on { color: var(--accent); }
.gwf-stage .xpay { display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: center; max-width: 760px; font-size: clamp(11px, 1.1vw, 14px); color: var(--ink-dim); }
.gwf-stage .xpay b { color: var(--ink); } .gwf-stage .xpay .on { color: var(--accent); } .gwf-stage .xpay .on b { color: var(--accent); }
.gwf-stage .xpuck { display: inline-flex; gap: 8px; align-items: baseline; padding: 4px 16px; border-radius: 999px; border: 2px solid var(--border); color: var(--ink-dim); font-weight: 800; letter-spacing: .08em; }
.gwf-stage .xpuck.on { border-color: var(--accent); color: var(--ink); } .gwf-stage .xpuck b { font-family: var(--font); font-size: 1.6em; color: var(--accent); } .gwf-stage .xpuck small { color: var(--ink-dim); font-weight: 600; }
.gwf-stage .xpg { display: flex; flex-direction: column; gap: clamp(8px, 1.4vh, 16px); }
.gwf-stage .xpg .pcard { width: clamp(36px, 5.4vh, 60px); height: clamp(52px, 7.8vh, 86px); } .gwf-stage .xpg .pcard .pc-r { font-size: clamp(14px, 2.4vh, 26px); } .gwf-stage .xpg .pcard .pc-s { font-size: clamp(12px, 2.2vh, 22px); } .gwf-stage .xpg .pcard-row { min-height: clamp(52px, 7.8vh, 86px); }
.gwf-stage .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
@keyframes gwf-card-in { from { transform: translateY(-18px) scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes gwf-shake { 0% { transform: rotate(-9deg) translateY(-3px); } 50% { transform: rotate(8deg) translateY(3px); } 100% { transform: rotate(-9deg) translateY(-3px); } }
@keyframes gwf-flip { 0% { transform: rotateX(0) translateY(0); } 50% { transform: rotateX(180deg) translateY(-18px); } 100% { transform: rotateX(360deg) translateY(0); } }
@keyframes gwf-mix-a { 50% { transform: translateX(115%); } } @keyframes gwf-mix-b { 50% { transform: translateY(-16%); } } @keyframes gwf-mix-c { 50% { transform: translateX(-115%); } }
/* controls-as-data */
.gwf-controls { display: flex; flex-direction: column; gap: 10px; min-width: 0; max-width: 100%; }
.gwf-controls .info { color: var(--bone-2); font-size: .95rem; min-height: 1.3em; }
.gwf-controls .btns { display: flex; flex-wrap: wrap; gap: 8px; }
.gwf-controls .btns button { min-height: 48px; font-size: .74rem; padding: 0 14px; }
.gwf-controls.phone .btns button { min-height: var(--tap); flex: 1 1 40%; font-size: .8rem; }
.gwf-controls .inputs { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .gwf-controls .inputs input { max-width: 140px; min-height: 48px; }
.gwf-controls .grid { display: grid; gap: 5px; max-width: min(520px, 100%); }
.gwf-controls .grid button { min-height: 40px; min-width: 0; padding: 0 4px; font-size: .72rem; font-family: var(--font-body); letter-spacing: 0; text-transform: none; border-color: var(--line); }
.gwf-controls.phone .grid button { min-height: 52px; }
.gwf-controls .grid button.picked, .gwf-controls .grid button.safe { border-color: var(--gold); color: var(--gold-2); } .gwf-controls .grid button.hit { border-color: var(--blood); background: #3a1216; }
.gwf-controls .grid button.red { color: #f2b3b3; } .gwf-controls .grid button.green { color: #9fd49a; }
.gwf-controls .powerups { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; border-top: 1px dashed var(--line); padding-top: 8px; }
.gwf-controls .powerups button { min-height: 40px; font-size: .66rem; }
.gwf-wheel { display: inline-block; position: relative; } .gwf-wheel svg { display: block; } .gwf-wheel .ptr { position: absolute; top: -6px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 18px solid var(--gold-2); filter: drop-shadow(0 2px 2px #000); }
.gwf-wheel g.face { transition: transform 3.2s cubic-bezier(.12,.8,.12,1); transform-origin: 50% 50%; }
`;
let cssDone = false;
export function ensureStageCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style'); s.id = 'gwf-stage-css'; s.textContent = STAGE_CSS; document.head.append(s);
}

// ── controls-as-data → DOM ───────────────────────────────────────────────────────────────────────
// `controls` = { info, buttons:[{label, a, p, primary, danger, disabled, hidden, from}], inputs?, grid? }.
// `act(a, p)` is called with the merged payload. Hidden picks render here (this IS the acting device).
export function renderControls(el, controls, act, { phone = false, extra = null } = {}) {
  el.replaceChildren(); el.className = `gwf-controls${phone ? ' phone' : ''}`;
  if (!controls) return el;
  const info = document.createElement('div'); info.className = 'info'; info.textContent = controls.info || ''; el.append(info);
  const inputs = {};
  if (controls.inputs?.length) {
    const box = document.createElement('div'); box.className = 'inputs';
    for (const inp of controls.inputs) { const i = document.createElement('input'); i.type = inp.type || 'text'; i.value = inp.value ?? ''; if (inp.min != null) i.min = inp.min; if (inp.max != null) i.max = inp.max; if (inp.step != null) i.step = inp.step; i.id = `ctl-${inp.id}`; inputs[inp.id] = i; box.append(i); }
    el.append(box);
  }
  const payloadFor = (bt) => { const p = { ...(bt.p || {}) }; for (const [k, id] of Object.entries(bt.from || {})) { const i = inputs[id]; if (i) p[k] = i.type === 'number' ? Number(i.value) : i.value; } return p; };
  if (controls.grid?.cells?.length) {
    const g = document.createElement('div'); g.className = 'grid'; g.style.gridTemplateColumns = `repeat(${controls.grid.cols || 5}, 1fr)`;
    for (const cell of controls.grid.cells) { const b = document.createElement('button'); b.type = 'button'; b.textContent = cell.label; b.className = cell.state || ''; b.disabled = !!cell.disabled; b.addEventListener('click', () => act(cell.a, cell.p || {})); g.append(b); }
    el.append(g);
  }
  const btns = document.createElement('div'); btns.className = 'btns';
  for (const bt of controls.buttons || []) { const b = document.createElement('button'); b.type = 'button'; b.textContent = bt.label; b.className = `${bt.primary ? 'primary' : ''} ${bt.danger ? 'danger' : ''}`.trim(); b.disabled = !!bt.disabled; b.addEventListener('click', () => act(bt.a, payloadFor(bt))); btns.append(b); }
  el.append(btns);
  if (extra) el.append(extra);
  return el;
}

// ── drive a Round in the page ────────────────────────────────────────────────────────────────────
// mountRound({ round, stageEl, controlsEl, phone, powerUps, autoSettle, onChange(round), onSettle(outcome) })
// Renders the controls and the live stage, ticks while the stage animates (Crash, reveals), and calls onSettle once
// the round has a result and the animation is done (auto) or when settle() is called (S key). Returns a handle.
export function mountRound({ round, stageEl, controlsEl, phone = false, powerUps = false, autoSettle = true, onChange = null, onSettle = null, now = () => Date.now() }) {
  ensureStageCss();
  let timer = null, settled = false, forkUi = null;
  const draw = () => {
    const t = now();
    if (stageEl) { stageEl.className = 'gwf-stage'; stageEl.innerHTML = round.stage(t); }
    if (controlsEl) {
      let extra = null;
      if (powerUps && !round.settled) {
        extra = document.createElement('div'); extra.className = 'powerups';
        const mk = (label, fn, dis = false) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = dis; b.addEventListener('click', () => { fn(); after(); }); return b; };
        if (round.g.forkOptions) { round.g.forkOptions.forEach((o, i) => extra.append(mk(`Fork ${i + 1}: ${o.label}`, () => round.pickFork(i)))); }
        else if (round.g.pending) { extra.append(mk('✅ Accept', () => round.act('accept')), mk('🔁 Reroll', () => round.reroll(), !round.canReroll()), mk('🔱 Fork', () => round.fork(), !round.canFork())); }
        else if (round.canNudge()) { const labels = round.nudgeLabels(); if (labels.length && labels.length <= 40) { const sel = document.createElement('select'); sel.style.maxWidth = '160px'; sel.style.minHeight = '40px'; sel.append(new Option('Nudge towards…', '')); labels.forEach(l => sel.append(new Option(l, l))); sel.addEventListener('change', () => { if (sel.value) round.nudge(sel.value); }); extra.append(sel); } }
      }
      renderControls(controlsEl, round.controls(), (a, p) => { if (a === 'pickFork') round.pickFork(p.i); else round.act(a, p, now()); after(); }, { phone, extra });
    }
  };
  const after = () => { draw(); onChange?.(round); schedule(); };
  const settle = (force = false) => { if (settled || !round.settled) return false; if (!force && !readyToSettle(round, now())) return false; settled = true; stop(); draw(); onSettle?.(round.outcome(), round); return true; };
  const tick = () => {
    const t = now();
    if (stageEl && (G.gameNeedsTicks(round.g, t) || !round.settled || t < round.revealAt() + 1500)) { stageEl.innerHTML = round.stage(t); }
    if (round.gameId === 'crash' && round.g.phase === 'running' && G.crashHasCrashed(round.g, t)) { round.act('cashout', {}, t); draw(); onChange?.(round); }
    if (autoSettle && round.settled && settle()) return;
    if (!round.settled || t < round.revealAt() + 1500 || G.gameNeedsTicks(round.g, t)) return;
    stop();
  };
  const schedule = () => { if (!timer) timer = setInterval(tick, 60); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  draw(); schedule(); if (round.settled) tick();
  return { round, redraw: draw, settle: () => settle(true), tick, stop, get settled() { return settled; } };
}

// ── closed-form returns ──────────────────────────────────────────────────────────────────────────
const BAC = { player: 0.446247, banker: 0.458597, tie: 0.095156 };
export const SKILL_RETURNS = { blackjack: 'about 99% with sensible play', war: 'about 97%', reddog: 'about 97%', videopoker: 'about 97% with sensible holds', threecard: 'about 97% with sensible play', letitride: 'about 96% with sensible play', holdem: 'about 97% with sensible play', paigow: 'about 97%' };
export function closedFormReturns(gameId, odds = null) {
  const o = odds || baseOdds(gameId), out = [], push = (label, rtp) => { if (Number.isFinite(rtp)) out.push({ label, rtp }); };
  try {
    switch (gameId) {
      case 'fifty': push('50/50 Wheel', Number(o.winChance) * (1 + Number(o.payout))); break;
      case 'bigwheel': { const seg = o.segments || [], t = seg.reduce((s, x) => s + Number(x.weight), 0); push('Big Wheel', seg.reduce((s, x) => s + Number(x.weight) * Number(x.mult), 0) / t); break; }
      case 'roulette': push('red/black', 18 / o.pockets * (1 + Number(o.even))); push('dozen', 12 / o.pockets * (1 + Number(o.dozen))); push('single number', 1 / o.pockets * (1 + Number(o.straight))); break;
      case 'crash': push('Crash', 1 - Number(o.houseEdge)); break;
      case 'mines': push('one pick', (o.grid - o.mines) / o.grid * G.minesMult(o, 1)); break;
      case 'baccarat': push('player', BAC.player * (1 + Number(o.player)) + BAC.tie); push('banker', BAC.banker * (1 + Number(o.banker)) + BAC.tie); push('tie', BAC.tie * (1 + Number(o.tie))); break;
      case 'plinko': { const m = G.plinkoMults(o), n = m.length - 1; push('Plinko', m.reduce((s, x, k) => s + G.binom(n, k) * x, 0) / 2 ** n); break; }
      case 'hilo': push('per call', 1 - Number(o.houseEdge)); break;
      case 'dice': push('under 50', G.diceChance('under', 50) / 100 * G.diceMult(o, 'under', 50)); break;
      case 'slots': push('Slots', G.slotsRtp(G.slotsSymbols(o))); break;
      case 'keno': { const R = G.kenoRules(o); for (const k of [1, 3, 5, R.maxPicks]) if (k <= R.maxPicks) push(`${k} pick${k === 1 ? '' : 's'}`, G.kenoRtp(R, k)); break; }
      default: if (EXTRA[gameId]?.returns) for (const r of EXTRA[gameId].returns(o)) push(r.label, r.rtp);
    }
  } catch { /* a plug-in without closed-form maths */ }
  return out;
}
export function returnsText(gameId, odds = null) {
  const rows = closedFormReturns(gameId, odds);
  if (!rows.length) return SKILL_RETURNS[gameId] || 'depends on play — see the measured figure';
  const lo = Math.min(...rows.map(r => r.rtp)), hi = Math.max(...rows.map(r => r.rtp));
  return lo === hi ? `${(lo * 100).toFixed(1)}%` : `${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}% depending on the bet`;
}

// ── a small SVG wheel ────────────────────────────────────────────────────────────────────────────
const PALETTE = ['#5a1218', '#2b2218', '#1f2a33', '#3a2a12', '#23301f', '#2a1a2e', '#3a1a1a', '#1d1d2a'];
// Slices are proportional to `weights` (the odds) — the same geometry as packages/ui/wheel.js.
export function wheelSvg({ outcomes, weights = null, index = null, size = 260, colors = null }) {
  const n = Math.max(1, outcomes.length), r = size / 2 - 4, cx = size / 2, cy = size / 2;
  const A = arcs(outcomes, weights);
  const wrap = document.createElement('div'); wrap.className = 'gwf-wheel'; wrap.style.width = `${size}px`;
  const seg = (i) => {
    const { a0: d0, a1: d1, span } = A[i]; if (span <= 0) return '';
    const a0 = (d0 - 90) * Math.PI / 180, a1 = (d1 - 90) * Math.PI / 180, large = span > 180 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const am = (a0 + a1) / 2, tx = cx + r * 0.62 * Math.cos(am), ty = cy + r * 0.62 * Math.sin(am), rot = (am * 180) / Math.PI;
    const label = String(outcomes[i] ?? '').slice(0, span < 20 ? 8 : 14);
    return `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${colors?.[i] || PALETTE[i % PALETTE.length]}" stroke="#c9a45c" stroke-width="1"/><text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" fill="#e9e1cf" font-size="${n > 10 ? 9 : 11}" font-family="Cinzel, serif">${esc(label)}</text>`;
  };
  wrap.innerHTML = `<div class="ptr"></div><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><g class="face">${Array.from({ length: n }, (_, i) => seg(i)).join('')}<circle cx="${cx}" cy="${cy}" r="14" fill="#0d0a0b" stroke="#c9a45c" stroke-width="2"/></g></svg>`;
  const face = wrap.querySelector('g.face');
  let turns = 0;
  wrap.spinTo = (i) => { turns += 4; const target = -(A[i]?.mid ?? 0) - turns * 360; face.style.transform = `rotate(${target}deg)`; };
  if (index != null) requestAnimationFrame(() => wrap.spinTo(index));
  return wrap;
}

// ── an in-memory sandbox room ────────────────────────────────────────────────────────────────────
// Reducer only: ROOM_CREATED → one seat → creation → RUN_START, so wheels, pets, monsters and the map exist.
export function makeSandbox({ seed = 7, classId = 'enforcer', mode = 'ffa', tier = 1, size = 'short', name = 'Tester', extraSeats = 1 } = {}) {
  let now = 1_700_000_000_000, seq = 0, state = null;
  const apply = (type, payload, actor = 'gm') => { state = applyEvent(state || {}, { ...makeEvent(type, payload, { actor, ts: now }), seq: ++seq }, { clone: false, strict: false }); now += 1000; return state.lastError && state.lastError.ts === now - 1000 && state.lastError.type === type ? state.lastError : null; };
  apply('ROOM_CREATED', { roomId: 'lab', code: 'LAB', seed, mode, tier, size, gmPinHash: 'lab' });
  apply('PLAYER_JOIN', { playerId: 'tester', name, deviceId: 'lab' }, 'system');
  for (let i = 0; i < extraSeats; i++) apply('PLAYER_JOIN', { playerId: `sparring${i}`, name: ['Sparring Partner', 'Second', 'Third'][i] || `Seat ${i}`, deviceId: `lab${i}` }, 'system');
  apply('CREATION_OPEN', {});
  apply('CHAR_LOOK', { name, crest: '🎲', look: { body: 0, skin: 0, face: 0, hair: 0, coat: '#5a1218' } }, 'tester');
  apply('CHAR_CLASS', { classId }, 'tester');
  apply('CHAR_LOCK', { alloc: {} }, 'tester');
  apply('RUN_START', {});
  const ctx = () => ({ now, actor: 'gm', isGm: true, payload: {}, B: (g) => group(state, g) });
  return { get state() { return state; }, set state(s) { state = s; }, apply, ctx, get now() { return now; }, tick: (ms = 1000) => { now += ms; }, tester: () => characterOf(state, 'tester') };
}

// ── bot runs in the browser ──────────────────────────────────────────────────────────────────────
// tools/bots.mjs › runGame, with the loop made async so the page can draw progress: onProgress({ guard, state, now, t0 }).
const COST_MS = { default: 4000, MOVE_STEP: 2500, ITEM_RESOLVE: 15000, CHAR_STAT_GAMBLE: 20000, MONSTER_ACT: 12000, TURN_END: 3000, PLAYER_READY: 1000, CHALLENGE_STEP: 6000, CHALLENGE_REPORT: 45000 };
export async function runGame({ bots = 4, mode = 'ffa', tier = 1, size = 'regular', seed = 1, maxEvents = 30000, maxSimMs = 2 * 3600 * 1000 * 2, aggression = 0.5, yieldEvery = 60 } = {}, onProgress = null) {
  let now = 1_700_000_000_000, seq = 0;
  const rng = makeRng(seed * 7919 + 17);
  const recent = [];
  let state = applyEvent({}, { ...makeEvent('ROOM_CREATED', { roomId: 'bots', code: 'BOTS', seed, mode, tier, size, gmPinHash: 'x' }, { actor: 'gm', ts: now }), seq: ++seq }, { clone: false, strict: true });
  const apply = (type, payload, actor) => {
    const ev = { ...makeEvent(type, payload, { actor, ts: now }), seq: ++seq };
    recent.push(`${type}@${actor}`); if (recent.length > 14) recent.shift();
    state = applyEvent(state, ev, { clone: false, strict: false });
    const err = state.lastError && state.lastError.ts === now && state.lastError.type === type ? state.lastError : null;
    now += COST_MS[type] || COST_MS.default;
    return { err };
  };
  const ids = [];
  for (let i = 0; i < bots; i++) { const id = 'bot' + i; ids.push(id); apply('PLAYER_JOIN', { playerId: id, name: 'Bot ' + i, deviceId: 'dev' + i }, 'system'); }
  if (mode === 'teams') { const teams = {}; ids.forEach((id, i) => { const t = 't' + (i % 2); (teams[t] ||= { name: 'Team ' + (i % 2 + 1), members: [] }).members.push(id); }); apply('GM_SET_TEAMS', { teams }, 'gm'); }
  apply('CREATION_OPEN', {}, 'gm');
  const refusals = {}, counts = {}, curve = [];
  let stalls = 0, lastProgress = 0, stallWitness = null;
  const t0 = now;
  const count = (a, r) => { counts[a.type] = (counts[a.type] || 0) + 1; if (r.err) { const k = a.type + ': ' + r.err.message; refusals[k] = (refusals[k] || 0) + 1; } };
  for (let guard = 0; guard < maxEvents && state.phase !== 'ended' && now - t0 < maxSimMs; guard++) {
    let acted = false;
    if (state.phase === 'creation' || state.phase === 'lobby') {
      for (const id of ids) { const a = nextAction(state, id, rng, now, { aggression }); if (a) { const r = apply(a.type, a.payload, a.actor); count(a, r); acted = true; } }
      if (!acted && (state.phase === 'creation' || state.phase === 'lobby')) { const r = apply('RUN_START', {}, 'gm'); if (r.err) { stallWitness = 'RUN_START refused: ' + r.err.message; break; } acted = true; }
    } else {
      for (const a of tableDuties(state, rng, now)) { const r = apply(a.type, a.payload, a.actor); count(a, r); if (!r.err) acted = true; }
      const order = [currentPlayerId(state), ...ids.filter(id => id !== currentPlayerId(state))].filter(Boolean);
      for (const id of order) {
        const a = nextAction(state, id, rng, now, { aggression }); if (!a) continue;
        const r = apply(a.type, a.payload, a.actor); count(a, r); if (!r.err) acted = true;
        if (a.type === 'TURN_END' || a.type === 'TURN_TIMEOUT') break;
      }
    }
    if (acted) lastProgress = guard;
    else if (guard - lastProgress > 40) { stalls++; stallWitness = describeStall(state) + ' recent=[' + recent.join(' > ') + ']'; apply('TURN_END', {}, 'gm'); lastProgress = guard; if (stalls > 25) break; }
    if (state.phase === 'playing' && state.turnIdx % Math.max(1, ids.length) === 0 && curve[curve.length - 1]?.round !== state.round) curve.push({ round: state.round, simMin: Math.round((now - t0) / 60000), health: ids.map(id => characterOf(state, id)?.health ?? null), gold: ids.map(id => characterOf(state, id)?.gold ?? null) });
    if (onProgress && guard % yieldEvery === 0) { onProgress({ guard, state, now, t0, curve }); await new Promise(r => setTimeout(r, 0)); }
  }
  if (state.phase !== 'ended') apply('GM_END_RUN', { reason: 'runner cap' }, 'gm');
  const chars = ids.map(id => characterOf(state, id)).filter(Boolean);
  return {
    mode, bots, seed, turns: state.turnIdx, rounds: state.round, simMinutes: Math.round((now - t0) / 60000), events: seq, ended: state.endReason, winner: state.winner && (characterOf(state, state.winner)?.name || state.winner),
    deaths: chars.reduce((n, c) => n + (c.deaths || 0), 0), kills: chars.reduce((n, c) => n + (c.kills || 0), 0),
    monstersDead: Object.values(state.monsters).filter(m => m.dead).length, monstersTotal: Object.keys(state.monsters).length,
    items: chars.map(c => Object.keys(c.items || {}).length), levels: chars.map(c => c.level), names: chars.map(c => c.name), stalls, stallWitness, counts, refusals, curve: curve.slice(0, 120),
    legendaries: state.legendariesDropped || 0, challenges: Object.keys(state.challengeHistory || {}).length, letters: state.letters.length, log: state.log.slice(-40), state,
  };
}
function describeStall(state) {
  const pid = currentPlayerId(state), c = characterOf(state, pid), f = state.fight;
  return `phase=${state.phase} turnPhase=${state.turnPhase} mover=${pid} dead=${c?.dead} pos=${c?.pos} hp=${c?.health} fight=${f ? `${f.kind}/${f.turn}/done=${f.done}` : 'none'} prompt=${state.pendingPrompt ? state.pendingPrompt.kind + '@' + state.pendingPrompt.playerId : 'none'} challenge=${state.challenge ? (state.challenge.done ? 'done' : state.challenge.spun ? 'spun' : 'unspun') : 'none'} held=${Object.keys(state.held).join(',')} lastError=${state.lastError?.message || ''} log=[${state.log.slice(-4).map(l => l.text).join(' | ')}]`;
}
// The Health curve: one polyline per bot over the rounds.
export function curveSvg(curve, { width = 520, height = 160, key = 'health' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', '100%'); svg.style.maxWidth = `${width}px`; svg.style.background = 'rgba(0,0,0,.25)'; svg.style.borderRadius = '6px';
  if (!curve.length) return svg;
  const n = curve[0][key].length, max = Math.max(1, ...curve.flatMap(p => p[key].map(v => v ?? 0)));
  const cols = ['#e0c07a', '#f2b3b3', '#9fd49a', '#8f6cff', '#6fd36a', '#d13c9f', '#ff7a2a', '#9aa7b0'];
  let s = '';
  for (let i = 0; i < n; i++) {
    const pts = curve.map((p, k) => `${(k / Math.max(1, curve.length - 1) * (width - 20) + 10).toFixed(1)},${(height - 10 - ((p[key][i] ?? 0) / max) * (height - 20)).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${cols[i % cols.length]}" stroke-width="1.6"/>`;
  }
  s += `<text x="12" y="14" fill="#9a917f" font-size="10" font-family="monospace">${key} · max ${max} · ${curve.length} rounds</text>`;
  svg.innerHTML = s;
  return svg;
}

// ── small utilities ──────────────────────────────────────────────────────────────────────────────
export function download(name, text, type = 'application/json') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
export async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
export const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;
