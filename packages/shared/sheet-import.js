// One-time import of the legacy "GWF Config" Google Sheet into balance.json's shape. Accepts either the JSON
// the legacy Apps Script endpoint returned ({ Config: {...}, Games: [...], ... }) or a CSV export of the Config
// tab (Key,Value rows). Only keys with a known mapping move across; everything else is reported, not guessed.
// The Sheet is never read live: this runs from a file the GM picks in the console, or from the CLI:
//   node tools/sheet-import.mjs legacy-config.json > overrides.json   (CLI wrapper over this module)

// legacy Config key → balance path (and an optional transform)
export const MAP = {
  StartingBank: ['gold.startingGold'],
  MinBet: ['items.stakeCommon'],
  TurnSeconds: ['clock.perTurnSeconds'],
  ShotClockSeconds: ['clock.perTurnSeconds'],
  LoanMax: ['bloodPact.max'],
  LoanInterest: ['bloodPact.interest', (v) => (v > 1 ? v / 100 : v)],
  LoanDueTurns: ['bloodPact.dueTurns'],
  CollectorPerTurn: ['bloodPact.collectorPerTurn'],
  MaxLoans: ['bloodPact.maxPacts'],
  ChaosTierUpEveryRounds: ['chaos.tierUpEveryRounds'],
  ChaosMaxTier: ['chaos.maxTier'],
  AuctionMinBid: ['auction.minBid'],
  KOBounty: ['gold.perKO'],
  PotionHeal: ['health.potionHeal'],
  InnHeal: ['health.innHeal'],
  MaxPlayers: ['table.maxPlayers'],
  SeasonNights: ['runs.seasonNights'],
  PetTeamMax: ['pets.teamMax'],
  LevelCap: ['xp.levelCap'],
};

export function importSheet(text) {
  let data; const problems = [];
  const t = text.trim();
  if (t.startsWith('{')) data = JSON.parse(t);
  else { // CSV Key,Value
    data = { Config: {} };
    for (const line of t.split(/\r?\n/)) { const [k, v] = line.split(',').map(s => s?.trim().replace(/^"|"$/g, '')); if (k && v != null && k !== 'Key') data.Config[k] = isNaN(Number(v)) ? v : Number(v); }
  }
  const config = data.Config || data.config || data;
  const balance = {}; let count = 0;
  for (const [k, raw] of Object.entries(config)) {
    const m = MAP[k];
    if (!m) { problems.push(`${k}: no RPG equivalent (ignored)`); continue; }
    const [path, fn] = m; const [g, key] = path.split('.');
    const v = Number(raw); if (!Number.isFinite(v)) { problems.push(`${k}: not a number`); continue; }
    (balance[g] ||= {})[key] = fn ? fn(v) : v; count++;
  }
  if (data.Games) problems.push(`Games tab (${data.Games.length} rows): odds overrides are not imported; the 36 games keep their built-in odds (edit per item later).`);
  if (data.Pets || data.PetSpecies) problems.push('Pets tabs: species now live in data/pets.json; not imported.');
  return { balance, count, problems };
}
