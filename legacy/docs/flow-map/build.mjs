import fs from 'node:fs';
const B = 'built', M = 'manual', P = 'pending', I = 'idea', X = 'blocked';
// n(name, status, note, check?)  — check = what a person has to do (manual / blocked rows)
const n = (name, status, note = '', check = '') => ({ name, status, note, check });
const stages = [
  { id: 'setup', kicker: 'Before anyone sits down', title: 'Set up the table', flow: 'seq', groups: [
    { label: '', seq: true, nodes: [
      n('Open GM monitor + player view', B, 'Two windows, same browser, same computer.'),
      n('Load the house rules', B, 'Built-in config, or the Google Sheet tab by tab.'),
      n('Config check', B, 'Chip next to Settings: says what is mistyped or missing.'),
      n('Seat players', B, 'Type a name or click a saved player. Pets come with them.'),
      n('Start session', B, 'Board is dealt from a seed, so undo can rewind the dice.'),
    ] },
    { label: 'Also at setup', nodes: [
      n('Player photos', M, 'Upload crops to a 64 px token.', 'Add a player with a photo; nothing automated covers the upload.'),
      n('Four themes', B, 'Noir, Vapor, Felt, Riviera. All pass contrast checks.'),
      n('Light theme on the TV', M, 'Riviera was recoloured this round.', 'Put Riviera on the actual TV and read it from the couch.'),
      n('Sound', M, '23 cues × 4 theme voices, all synthesised.', 'Nobody has heard it. Click the shared screen once, press “♪ test”, then play a few turns.'),
      n('Reading the Sheet through the new script', M, 'sheet/Code.gs was written from the Sheet’s layout, not from the script deployed today.', 'Try it on a copy of the Sheet first, then point the GM window at the copy.'),
    ] },
  ] },
  { id: 'turn', kicker: 'Repeats for every player, every round', title: 'One turn', flow: 'seq', groups: [
    { label: '', seq: true, nodes: [
      n('Begin turn', B, 'Collector and loans tick. Skipped turns are burned here.'),
      n('In jail? Jail turn instead', B, 'Jumps to the Jail block below.'),
      n('Spin the Method Wheel', B, '11 ways to move.'),
      n('Move', B, 'Player calls directions, GM presses arrows.'),
      n('Land', B, 'On another player: Battle. Otherwise the tile resolves.'),
      n('End turn', B, 'Round counter, rank arrows, shot clock restarts.'),
    ] },
    { label: 'Ways to move', nodes: [
      n('Dice · D4 · Double Dice · Move One', B),
      n('Candy Land', B, 'Walk to a colour. Now gives up after two laps if the colour is gone.'),
      n('Teleport · Magnetism · Stay Put', B),
      n('Swap · Benevolence', B, 'Pick another player.'),
      n('The Long Walk', B, 'Walk until you bump into someone.'),
      n('Edge crossing → the Void', B, '20% per crossing; 9 outcomes.'),
      n('Shot clock', B, 'Optional. Only nags, never ends a turn.'),
    ] },
  ] },
  { id: 'tiles', kicker: 'What the tile does', title: 'Tiles', groups: [
    { label: 'GAME tile → a minigame (bet, play, settle) — the 12 classics', nodes: [
      n('50/50 Wheel', B), n('Big Wheel', X, 'Works, but pays back 192% on average — players print Gold.', 'Decide: keep it generous, or give me a target return.'),
      n('Roulette', B), n('Crash', B), n('Mines', B),
      n('Blackjack', B, 'Splits to 4 hands, double after split, insurance.'),
      n('Baccarat', B), n('Plinko', B), n('Hi-Lo', B), n('Dice', B), n('Slots', B), n('Keno', B),
      n('GM Call', B, 'Fallback: GM says won or lost.'),
      n('Nudge · Reroll · Fork', B, 'Power-ups on chance games.'),
      n('Playtest the newer classics', M, 'Hi-Lo, Dice, Slots, Keno, Plinko, Baccarat and blackjack splits have only been played by scripts.', 'Use the Game Lab: play each, tick Works or Problem.'),
    ] },
    { label: '24 more games, added 10 October', nodes: [
      n('Quick games × 10', B, 'Coin Streak, War, Dragon Tiger, Red Dog, Chuck-a-Luck, Sic Bo, Under/Over 7, Wheel of Colours, Scratch Card, Limbo.'),
      n('Show games × 8', B, 'The Races, Tower, Chicken Cross, Pachinko, Deal or No Deal, Dice Hi-Lo, Ride the Bus, Thimbles.'),
      n('Table games × 6', B, 'Video Poker, Three Card Poker, Let It Ride, Casino Hold’em, Craps, Pai Gow Poker.'),
      n('Game Lab', B, 'A page with every game on one menu and a practice bankroll. Never touches a real session.'),
      n('Playtest the 24 new games', M, 'Rules, payouts and thousands of scripted rounds check out. No person has played them.', 'Open the Game Lab, rip through the list, tick Works or Problem, press “Copy report” and paste it to me.'),
      n('Which of the 36 stay on the board', X, 'All 36 are switched on, so each GAME tile is a lucky dip. Some (Pai Gow, Let It Ride, Hold’em) take explaining.', 'After testing, tell me which to switch off or keep for the lab only.'),
      n('Power-ups on the new games', P, 'Nudge, Reroll and Fork only work on the classic chance games.'),
      n('Everyone bets on The Races', I, 'Today one player bets per race. A table-wide bet needs a new betting step.'),
    ] },
    { label: 'Wheel tiles', nodes: [
      n('GOOD wheel', B, '12 outcomes incl. Mystery Egg, Power Surge.'),
      n('BAD wheel', B, '12 outcomes incl. Wild Encounter, Power Drain.'),
      n('START wheel', B, '6 outcomes.'),
    ] },
    { label: 'SHOP tile', nodes: [
      n('Exchange currencies', B, '21 currencies, rate rolled per session.'),
      n('Buy power-ups', B, '7 of the 8 do what they say.'),
      n('Hedge power-up', P, 'On sale for 200 Gold but has no effect. The config check now warns.'),
      n('Pet supplies', B, 'Egg, potion, XP candy, five held items.'),
    ] },
  ] },
  { id: 'jail', kicker: 'When a turn starts behind bars', title: 'Jail', groups: [
    { label: 'Four tiers, deeper is harder', nodes: [
      n('Buy out', B, '200 / 400 / 800 / 1,600 Gold.'),
      n('Skill check', B, 'Win a minigame the GM picks.'),
      n('Double or Detain', B, 'Coin flip: free and doubled, or one tier deeper.'),
      n('Jail Wheel', B, '10 outcomes, odds change by tier.'),
      n('Social barter', B, 'Someone else pays; they take a cut or you skip a turn.'),
      n('Pardon', B, 'Burned automatically.'),
    ] },
  ] },
  { id: 'battle', kicker: 'Two players on one tile', title: 'Battle', flow: 'seq', groups: [
    { label: '', seq: true, nodes: [
      n('Both put up a wager', B, 'Any currency, 100 Gold minimum in value.'),
      n('Battle Wheel picks the contest', B),
      n('Play it', B),
      n('Winner takes the pot', B),
    ] },
    { label: 'Contests', nodes: [
      n('Coin Flip · High Card · Dice Duel', B, 'Played on screen automatically.'),
      n('Pet Battle', B, 'If both have a pet.'),
      n('Name 10 + category wheel', B),
      n('Rock Paper Scissors, Thumb War, Staring…', B, 'Played at the table; GM clicks the winner. That is the design.'),
    ] },
  ] },
  { id: 'money', kicker: 'Any time the GM opens them', title: 'Money systems', groups: [
    { label: '', nodes: [
      n('Buy-in wheel', B, '8 mechanics carried out automatically.'),
      n('What a buy-in gives you', X, 'The wheel takes payment, but the game has no rule for what you get back.', 'Tell me: a fresh stake? how much?'),
      n('Auction', B, 'Lots, bids, going once / twice / sold.'),
      n('Loan Shark', B, '25% interest, 4 turns, then the Collector garnishes.'),
      n('GM transfer / adjust', B),
      n('Real-life side bets', B, 'Logged and shown on the TV; never touch Gold.'),
      n('Live odds panel', B, 'Change any game’s numbers for tonight.'),
      n('“Gold can’t go negative” switch', P, 'The setting exists but nothing enforces it.'),
    ] },
  ] },
  { id: 'pets', kicker: 'The D&D-and-Pokémon side game', title: 'Pets & Power Level', flow: 'seq', groups: [
    { label: '', seq: true, nodes: [
      n('Earn Power ⚡', B, 'From turns, wins, battles, jail. Caps at 1,000.'),
      n('Hatch an egg', B, '12 species, 5 rarities.'),
      n('Train, level, evolve', B, 'To level 20; new forms at 8 and 16.'),
      n('Fight', B, 'd20 + stats vs Armor Class, elements, status effects.'),
      n('Rewards', B, 'XP, Gold, item drops, trainer rank.'),
    ] },
    { label: 'Kinds of fight', nodes: [
      n('Boss fights', B, '5 bosses.'),
      n('Player vs player', B, 'Optional Gold wager.'),
      n('Wild encounters', B, 'Beat it, then roll to befriend it.'),
      n('Raids', B, '2–6 pets vs one boss; 2 raid-only bosses.'),
    ] },
    { label: 'Around the fights', nodes: [
      n('Held items', B, 'Five items; shop or boss drops.'),
      n('Trainer ranks', B, 'Rookie → Legend from lifetime Power.'),
      n('Pets carry over between nights', B, 'Stored with the saved player.'),
      n('Generated crests', B, 'Emoji on an element shield until real art exists.'),
      n('Real pet art', X, 'The game accepts an image per species and stage.', 'Send art (or say “keep the crests”).'),
      n('Is it fun and fair?', M, 'Earn rates, boss difficulty and element multipliers were tuned by simulation only.', 'Run one boss fight, one PvP and one raid at the table; tell me what felt slow or lopsided.'),
      n('Species names and roster', X, 'I invented all 12 species, the bosses and the items.', 'Keep, rename, or replace them.'),
    ] },
  ] },
  { id: 'gm', kicker: 'The GM can do these at any moment', title: 'GM powers', groups: [
    { label: '', nodes: [
      n('Chaos, tiers 1–5', B, 'Reshuffle up to apocalypse; loud or silent; one-step undo.'),
      n('Undo', B, '30 clicks back, dice included.'),
      n('Turn order · sit out · return', B),
      n('Force a wheel result · move a player · retcon a tile', B),
      n('Add a player mid-session', B),
      n('Hotkeys + printable card', B, '37 shortcuts.'),
      n('Hotkeys on a Mac / on AltGr keyboards', M, 'Rewritten to survive Option and Shift combos.', 'Press Ctrl+Alt+G, Ctrl+Alt+Shift+3 and Ctrl+Alt+⌫ on the real GM keyboard.'),
      n('Banner text · text size · high contrast', B),
      n('Ledger viewer + CSV', B),
    ] },
  ] },
  { id: 'end', kicker: 'Last call', title: 'End of the night', flow: 'seq', groups: [
    { label: '', seq: true, nodes: [
      n('End session', B),
      n('Recap on the TV', B, 'Standings, awards, Gold chart, per-game table.'),
      n('Hall of Fame', B, 'All-time wins and records.'),
      n('Saved players keep pets and Power', B),
      n('Wipe the table for next time', B, 'A restore point is kept.'),
    ] },
  ] },
  { id: 'safety', kicker: 'Under the table', title: 'Saving, recovery and docs', groups: [
    { label: 'Not losing the night', nodes: [
      n('Saved after every click', B, 'Refresh either window and carry on.'),
      n('Restore points', B, 'Every round and every 5 minutes; newest 4.'),
      n('Crash banner', B, 'Offers Undo, Restore, Save file.'),
      n('Corrupt-save recovery', B, 'Falls back to the newest restore point.'),
      n('Session file', B, 'Save tonight to a file, load it elsewhere.'),
      n('Moving between two real computers', M, 'Works in the scripted browser.', 'Save a session file on one PC and load it on another.'),
      n('Old saves upgrade themselves', B),
    ] },
    { label: 'Explaining the game', nodes: [
      n('Player rulebook page', B, 'Written from the live config, so the odds are always current.'),
      n('GM quickstart', B),
      n('Printed hotkey card and rulebook', M, 'Print styles exist.', 'Print both once and check the page breaks.'),
    ] },
    { label: 'Proof it works', nodes: [
      n('796 unit tests', B), n('Scripted two-window play-through', B, 'Every panel, no errors.'), n('Scripted Game Lab run', B, 'All 36 games played through in a browser.'),
      n('Bot soak', B, '196,000 random actions (new games included in later runs); balances always match the ledger.'),
      n('Payout report', B, 'Expected return of every game.'),
    ] },
  ] },
  { id: 'ship', kicker: 'Between this folder and game night', title: 'Getting it live', groups: [
    { label: '', nodes: [
      n('Deploy to Netlify', X, 'The live site is still the 3 September build. None of the above is on it.', 'Log into Netlify in Chrome and tell me to deploy, or drag the “site” folder onto Netlify → Deploys.'),
      n('Bring the Google Sheet up to date', X, 'The Sheet’s lists win over the built-ins, and it predates 28 of the 36 games and the five pet rows on the wheels. With the Sheet connected, those are missing from the real table (the Game Lab always shows all 36).', 'Either let me edit the Sheet, or paste sheet/Code.gs and run GWF → Add missing tabs & rows.'),
      n('Source in a private GitHub repo', P, 'Today it lives in one folder on one PC plus a zip.'),
    ] },
  ] },
  { id: 'later', kicker: 'Not started', title: 'Ideas', groups: [
    { label: 'Nothing here is designed or promised — say which ones you want', nodes: [
      n('Phones as player controllers', I, 'Players bet and pick moves from their own phone. Needs a small backend.'),
      n('Remote play', I, 'Friends join from another house. Same backend.'),
      n('Theme colours from the Sheet', I, 'Today the Sheet can only name the four built-in themes.'),
      n('Recorded sound packs', I, 'Real audio files instead of synthesised tones.'),
      n('Pet trading between players', I),
      n('Pet tournament bracket', I),
      n('Player-vs-player poker', I, 'Real Texas Hold’em between players needs hidden hands, so it needs phones.'),
      n('Achievements across nights', I),
      n('Replay a night from its ledger', I),
      n('Roblox version', I, 'The vault note calls this project a Roblox game. Is that a separate project?'),
    ] },
  ] },
];
const META = {
  built:   { label: 'Built and auto-tested', glyph: '●', blurb: 'Code exists; unit tests and the scripted play-through pass. Not the same as playtested by people.' },
  manual:  { label: 'Needs a human check', glyph: '◐', blurb: 'Built, but a test cannot judge it: sound, feel, real hardware, the real Sheet.' },
  blocked: { label: 'Waiting on you', glyph: '■', blurb: 'I need a decision, access or material before this can move.' },
  pending: { label: 'Pending development', glyph: '○', blurb: 'A known gap. Not built yet.' },
  idea:    { label: 'Idea only', glyph: '◇', blurb: 'Not designed, not committed.' },
};
const ORDER = ['built', 'manual', 'blocked', 'pending', 'idea'];
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const all = stages.flatMap(s => s.groups.flatMap(g => g.nodes.map(x => ({ ...x, stage: s.title }))));
const count = Object.fromEntries(ORDER.map(k => [k, all.filter(x => x.status === k).length]));
const node = (x) => `<li class="node s-${x.status}" data-s="${x.status}"><span class="g" aria-hidden="true">${META[x.status].glyph}</span><span class="nm">${esc(x.name)}</span><span class="st">${META[x.status].label}</span>${x.note ? `<span class="nt">${esc(x.note)}</span>` : ''}</li>`;
const group = (g) => `${g.label ? `<h3>${esc(g.label)}</h3>` : ''}<ol class="nodes${g.seq ? ' seq' : ''}">${g.nodes.map(node).join('')}</ol>`;
const stageHtml = (s, i) => `<section class="stage" id="${s.id}"><header><p class="kick">${esc(s.kicker)}</p><h2>${esc(s.title)}</h2></header>${s.groups.map(group).join('')}</section>`;
const todo = (k) => all.filter(x => x.status === k).map(x => `<tr><td><span class="g s-${k}" aria-hidden="true">${META[k].glyph}</span> <b>${esc(x.name)}</b><br><span class="where">${esc(x.stage)}</span></td><td>${esc(x.check || x.note)}</td></tr>`).join('');
const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const html = `<title>GWF Gameplay Flow Map</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${css}</style>
<main>
<header class="top">
  <p class="kick">Gambling With Friends · status as of 10 October 2026, evening</p>
  <h1>Gameplay flow map</h1>
  <p class="lede">A night of the game from first click to final standings, with every step marked by how finished it is. ${all.length} pieces in total.</p>
  <p class="warn"><span class="g s-blocked" aria-hidden="true">■</span> The live site is still the 3 September build. Everything marked built is in the project folder, not yet deployed.</p>
  <div class="legend" role="group" aria-label="Show one status">
    <button class="chip on" data-f="all" aria-pressed="true" id="f-all">Everything <b>${all.length}</b></button>
    ${ORDER.map(k => `<button class="chip s-${k}" data-f="${k}" aria-pressed="false" id="f-${k}"><span class="g" aria-hidden="true">${META[k].glyph}</span>${META[k].label} <b>${count[k]}</b></button>`).join('')}
  </div>
  <dl class="key">${ORDER.map(k => `<div><dt><span class="g s-${k}" aria-hidden="true">${META[k].glyph}</span>${META[k].label}</dt><dd>${META[k].blurb}</dd></div>`).join('')}</dl>
</header>
<nav class="spine" aria-label="Stages">${stages.map(s => `<a href="#${s.id}">${esc(s.title)}</a>`).join('<span aria-hidden="true">→</span>')}</nav>
<div class="map">${stages.map(stageHtml).join('<div class="link" aria-hidden="true"></div>')}</div>
<section class="lists" id="todo">
  <h2>Your list</h2>
  <p class="lede">The same amber and red pieces as above, with what each one needs from you.</p>
  <h3><span class="g s-manual" aria-hidden="true">◐</span> Needs a human check (${count.manual})</h3>
  <div class="tw"><table><thead><tr><th>Piece</th><th>How to check it</th></tr></thead><tbody>${todo('manual')}</tbody></table></div>
  <h3><span class="g s-blocked" aria-hidden="true">■</span> Waiting on you (${count.blocked})</h3>
  <div class="tw"><table><thead><tr><th>Piece</th><th>What I need</th></tr></thead><tbody>${todo('blocked')}</tbody></table></div>
</section>
</main>
<script>
(function () {
  var root = document.querySelector('main'), chips = document.querySelectorAll('.chip');
  function set(f) { if (f === 'all') root.removeAttribute('data-f'); else root.setAttribute('data-f', f); chips.forEach(function (c) { var on = c.dataset.f === f; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
  chips.forEach(function (c) { c.addEventListener('click', function () { set(c.classList.contains('on') && c.dataset.f !== 'all' ? 'all' : c.dataset.f); }); });
})();
</script>`;
fs.writeFileSync(new URL('./gwf-flow-map.html', import.meta.url), html);
console.log(all.length, count, html.length);
