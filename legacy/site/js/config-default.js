// Gambling With Friends — DEFAULT CONFIG (Phase 1)
// Mirrors the 16 Google Sheets tabs, seeded with roadmap v0.4 Appendix A values.
// When a Sheets endpoint is set, tabs fetched from Sheets override these, tab by tab.
// Everything here is a tunable. Nothing is hardcoded elsewhere.

import { extraConfigRows } from './games-extra.js';

export const DEFAULT_CONFIG = {

  // ── Tab 1: Config ──────────────────────────────────────────────
  Config: {
    StartingBank: 500,
    MinBet: 100,
    QuickBets: [100, 250, 500, 'ALL_IN'],
    VoidChance: 0.20,
    VoidEnabled: true,
    SpecialTilesShuffle: true,
    BattleMinWager: 100,
    AuctionDefaultLots: 'PER_CURRENCY',
    ShopRateMin: 0.5,
    ShopRateMax: 2.0,
    ShopCurrenciesPerVisit: 3,
    JailBuyoutT1: 200, JailBuyoutT2: 400, JailBuyoutT3: 800, JailBuyoutT4: 1600,
    JailSkillCheckStake: 100,
    JailRiskMinWager: 100,
    HouseEdgeMultiplier: 1.0,
    LongWalkMaxSteps: 10,
    BenevolenceSteps: 2,
    GoldCanGoNegative: true,
  },

  // ── Tab 2: Currencies (add a row = it exists) ──────────────────
  // GoldRate = reference value for payouts + leaderboard (shop-only exchange).
  Currencies: [
    { name: 'Gold',     goldRate: 1,    active: true, emoji: '🪙' },
    { name: 'Gems',     goldRate: 5,    active: true, emoji: '💎' },
    { name: 'Tickets',  goldRate: 0.5,  active: true, emoji: '🎟️' },
    { name: 'Bones',    goldRate: 0.25, active: true, emoji: '🦴' },
    { name: 'Shells',   goldRate: 0.75, active: true, emoji: '🐚' },
    { name: 'Keys',     goldRate: 10,   active: true, emoji: '🗝️' },
    { name: 'Chips',    goldRate: 1,    active: true, emoji: '🔵' },
    { name: 'Scrap',    goldRate: 0.2,  active: true, emoji: '⚙️' },
    { name: 'Pearls',   goldRate: 8,    active: true, emoji: '🫧' },
    { name: 'Fangs',    goldRate: 2,    active: true, emoji: '🦷' },
    { name: 'Vials',    goldRate: 3,    active: true, emoji: '🧪' },
    { name: 'Stars',    goldRate: 15,   active: true, emoji: '⭐' },
    { name: 'Runes',    goldRate: 12,   active: true, emoji: '🪬' },
    { name: 'Cogs',     goldRate: 0.6,  active: true, emoji: '🛞' },
    { name: 'Dice',     goldRate: 1.5,  active: true, emoji: '🎲' },
    { name: 'Cards',    goldRate: 0.4,  active: true, emoji: '🃏' },
    { name: 'Tokens',   goldRate: 0.8,  active: true, emoji: '🪙' },
    { name: 'Orbs',     goldRate: 20,   active: true, emoji: '🔮' },
    { name: 'Feathers', goldRate: 0.3,  active: true, emoji: '🪶' },
    { name: 'Skulls',   goldRate: 4,    active: true, emoji: '💀' },
    { name: 'Crowns',   goldRate: 50,   active: true, emoji: '👑' },
  ],

  // ── Tab 3: Board ───────────────────────────────────────────────
  Board: {
    cols: 8, rows: 5,
    tileCounts: { GAME: 29, GOOD: 3, BAD: 3, JAIL: 2, SHOP: 2, START: 1 },
    colorWeights: { Red: 10, Blue: 8, Green: 8, Yellow: 7, Purple: 5, Black: 2 },
    // Pinned tiles: index → type (8×5 grid: 7 = top-right, 32 = bottom-left).
    // The single START lives top-right; one JAIL is always bottom-left.
    pins: { 7: 'START', 32: 'JAIL' },
  },

  // ── Tab 4: Games (Phase 4) — `odds` are the live-adjustable tunables ─
  // Each GAME tile carries one of the built games (tile.gameId); the Live Odds
  // panel overrides these per session; HouseEdgeMultiplier scales all profits.
  Games: [
    { id: 'fifty',     name: '50/50 Wheel', icon: '⚖️', built: true,
      odds: { winChance: 0.5, payout: 1.0 } },
    { id: 'bigwheel',  name: 'Big Wheel',   icon: '🎡', built: true,
      odds: { segments: [
        { label: '1×',  mult: 1,  weight: 24 }, { label: '2×',  mult: 2,  weight: 15 },
        { label: '3×',  mult: 3,  weight: 8 },  { label: '5×',  mult: 5,  weight: 4 },
        { label: '10×', mult: 10, weight: 2 },  { label: '20×', mult: 20, weight: 1 },
        { label: 'LOSE', mult: 0, weight: 18 },
      ] } },
    { id: 'roulette',  name: 'Roulette',    icon: '🔴', built: true,
      odds: { pockets: 37, straight: 35, dozen: 2, even: 1 } },
    { id: 'crash',     name: 'Crash',       icon: '🚀', built: true,
      odds: { houseEdge: 0.04, growthPerSec: 0.10, maxMult: 50 } },
    { id: 'mines',     name: 'Mines',       icon: '💣', built: true,
      odds: { grid: 25, mines: 3, houseEdge: 0.03 } },
    // Blackjack: dealer stands on all 17s (dealerHitsSoft17: 1 to flip). Split pairs up to maxHands (double after
    // split allowed; split aces get one card each). Insurance (insurance: 0 to remove) is offered on a dealer ace.
    { id: 'blackjack', name: 'Blackjack',   icon: '🃏', built: true,
      odds: { blackjackPays: 1.5, dealerHitsSoft17: 0, decks: 6, maxHands: 4, insurance: 1, splitAcesOneCard: 1 } },
    // Baccarat: payouts are X:1 per side; a Tie pushes Player/Banker bets.
    { id: 'baccarat',  name: 'Baccarat',    icon: '🎴', built: true,
      odds: { player: 1, banker: 0.95, tie: 8, decks: 8 } },
    // Plinko: one multiplier per slot (rows = slots − 1). Values are TOTAL return, so 0.3 = lose 70%. ~96.6% RTP.
    { id: 'plinko',    name: 'Plinko',      icon: '🔻', built: true,
      odds: { mults: [33, 11, 4, 2, 1, 0.6, 0.3, 0.6, 1, 2, 4, 11, 33] } },
    // Hi-Lo: call higher / lower, cash out any time. Aces low, equal card = free redraw.
    { id: 'hilo',      name: 'Hi-Lo',       icon: '🔼', built: true,
      odds: { houseEdge: 0.03, maxMult: 100 } },
    // Dice: roll 1–100, bet under / over a target. min/maxChance bound how safe or wild a bet may be (%).
    { id: 'dice',      name: 'Dice',        icon: '🎲', built: true,
      odds: { houseEdge: 0.03, minChance: 2, maxChance: 95 } },
    // Slots: odds.symbols overrides the reel strip — [{ id, icon, weight, three, two }]. Default returns ~94.5%.
    { id: 'slots',     name: 'Slots',       icon: '🎰', built: true, odds: {} },
    // Keno: pick up to 10 of 40, 10 are drawn. odds.pays[picks][hits] overrides the paytable (~93–96% per row).
    { id: 'keno',      name: 'Keno',        icon: '🔢', built: true, odds: { numbers: 40, drawn: 10, maxPicks: 10 } },
    // 24 plug-in games (rules, tunables and defaults live in site/js/games-quick.js, games-show.js, games-table.js).
    // Put any of a game's numbers in `odds` here (or in the Sheet) to override them, e.g. { houseEdge: 0.05 }.
    ...extraConfigRows(),
    { id: 'placeholder', name: 'GM Call (did they win?)', icon: '❓', built: true, hidden: true },
  ],

  // ── Wheel_Start — spins when a player lands on START after the session began ─
  Wheel_Start: [
    { label: 'Welcome Home',   verb: 'GOLD_DELTA',        params: { amount: 150 },  weight: 22, desc: '+150 Gold for coming back' },
    { label: 'Rent Is Due',    verb: 'GOLD_DELTA',        params: { amount: -100 }, weight: 18, desc: '−100 Gold. Home isn\'t free.' },
    { label: 'Second Wind',    verb: 'SPIN_METHOD_AGAIN', params: {},               weight: 18, desc: 'Spin the Method Wheel again' },
    { label: 'Souvenir',       verb: 'SECONDARY_RANDOM_GAIN', params: { units: 3 }, weight: 16, desc: '+3 of a random secondary' },
    { label: 'Housewarming',   verb: 'PAY_TO_POOREST',    params: { amount: 50 },   weight: 10, desc: 'Tip the poorest player 50 Gold' },
    { label: 'Nothing',        verb: 'NOTHING',           params: {},               weight: 16, desc: 'Just passing through' },
  ],

  // ── Chaos (Phase 5) — what each shuffle tier touches. All tunables. ─
  Chaos: [
    { tier: 1, label: 'Reshuffle',   games: true,  colors: false, specials: false, positions: false, shopRates: false, desc: 'GAME tiles trade their minigames' },
    { tier: 2, label: 'Repaint',     games: true,  colors: true,  specials: true,  positions: false, shopRates: false, desc: '+ colors reshuffle, GOOD/BAD/JAIL/SHOP reposition' },
    { tier: 3, label: 'Upheaval',    games: true,  colors: true,  specials: true,  positions: false, shopRates: true,  desc: '+ every shop rate re-rolls' },
    { tier: 4, label: 'Scatter',     games: true,  colors: true,  specials: true,  positions: true,  shopRates: true,  desc: '+ every free player teleported' },
    { tier: 5, label: 'Apocalypse',  games: true,  colors: true,  specials: true,  positions: true,  shopRates: true,  wildcard: true, desc: '+ one random GOOD↔BAD tile flips' },
  ],

  // ── Tab 5: Wheel_Method (two-stage movement, stage 1) ──────────
  Wheel_Method: [
    { label: 'Dice Roll',    verb: 'MOVE_DICE',    weight: 20, desc: '1d6, choose direction each step' },
    { label: 'Move One',     verb: 'MOVE_ONE',     weight: 8,  desc: 'Exactly 1 tile' },
    { label: 'D4',           verb: 'MOVE_D4',      weight: 12, desc: '1–4 steps' },
    { label: 'Candy Land',   verb: 'MOVE_CANDY',   weight: 12, desc: 'Color wheel → pick a direction, stop at first tile of that color' },
    { label: 'Teleport',     verb: 'MOVE_TELEPORT',weight: 8,  desc: 'Random tile, no walking' },
    { label: 'Stay Put',     verb: 'MOVE_STAY',    weight: 6,  desc: 'Resolve current tile again' },
    { label: 'Swap',         verb: 'MOVE_SWAP',    weight: 6,  desc: 'Trade positions with a player of your choice' },
    { label: 'Benevolence',  verb: 'MOVE_BENEV',   weight: 6,  desc: 'Move any other player 2 tiles, your directions' },
    { label: 'Magnetism',    verb: 'MOVE_MAGNET',  weight: 7,  desc: 'Pulled to nearest GOOD or BAD; ties break toward BAD' },
    { label: 'Double Dice',  verb: 'MOVE_2D6',     weight: 8,  desc: '2d6' },
    { label: 'The Long Walk',verb: 'MOVE_LONGWALK',weight: 7,  desc: 'Walk until occupied tile (Battle) or 10 steps' },
  ],

  // ── Wheel_Color (Candy Land stage; lives in Wheel_Method tab in Sheets, ColorMode column) ─
  Wheel_Color: [
    { label: 'Red',    color: 'Red',    double: false, weight: 14 },
    { label: 'Blue',   color: 'Blue',   double: false, weight: 14 },
    { label: 'Green',  color: 'Green',  double: false, weight: 14 },
    { label: 'Yellow', color: 'Yellow', double: false, weight: 14 },
    { label: 'Purple', color: 'Purple', double: false, weight: 12 },
    { label: 'Black',  color: 'Black',  double: false, weight: 8 },
    { label: 'DOUBLE Red',   color: 'Red',   double: true, weight: 4 },
    { label: 'DOUBLE Blue',  color: 'Blue',  double: true, weight: 4 },
    { label: 'DOUBLE Green', color: 'Green', double: true, weight: 4 },
    { label: 'DOUBLE Yellow',color: 'Yellow',double: true, weight: 4 },
    { label: 'DOUBLE Purple',color: 'Purple',double: true, weight: 4 },
    { label: 'DOUBLE Black', color: 'Black', double: true, weight: 4 },
  ],

  // ── Tab 6: Wheel_Void (20% of edge crossings) ──────────────────
  Wheel_Void: [
    { label: 'Customs',           verb: 'PCT_GOLD',        params: { pct: -10 }, weight: 10, desc: 'The Void inspects your bags. 10% of your Gold, please.' },
    { label: 'The Long Way',      verb: 'VOID_LONG_WAY',   params: {},           weight: 10, desc: 'Finish your move going the opposite direction' },
    { label: 'You Fell Off',      verb: 'TELEPORT_RANDOM', params: {},           weight: 12, desc: 'Dropped on a random tile. Move ends there.' },
    { label: 'Exile',             verb: 'VOID_EXILE',      params: {},           weight: 8,  desc: 'Sent to the farthest tile from where you crossed' },
    { label: 'Frequent Flyer',    verb: 'GOLD_DELTA',      params: { amount: 150 }, weight: 12, desc: 'The Void rewards loyalty. +150 Gold.' },
    { label: 'Toll Booth',        verb: 'GOLD_DELTA',      params: { amount: -100 }, weight: 15, desc: 'Pay the troll. −100 Gold.' },
    { label: 'Void Jackpot',      verb: 'GOLD_DELTA',      params: { amount: 500 }, weight: 5, desc: '+500 Gold from nowhere' },
    { label: 'You Were Never Here', verb: 'VOID_REWIND',   params: {},           weight: 8,  desc: 'Return to where this move started. It never happened.' },
    { label: 'Nothing',           verb: 'NOTHING',         params: {},           weight: 20, desc: 'The Void shrugs' },
  ],

  // ── Tab 7: Wheel_Good ──────────────────────────────────────────
  Wheel_Good: [
    { label: 'Payday',            verb: 'GOLD_DELTA',       params: { amount: 200 },  weight: 15, desc: '+200 Gold' },
    { label: 'Treasure Chest',    verb: 'GOLD_DELTA',       params: { amount: 500 },  weight: 8,  desc: '+500 Gold' },
    { label: 'Pardon',            verb: 'PARDON_GRANT',     params: {},               weight: 5,  desc: 'Hold it. Next time you would enter jail, it burns instead.' },
    { label: 'Lucky Streak',      verb: 'BUFF_NEXT_WIN',    params: { mult: 2 },      weight: 10, desc: 'Next game win pays 2×' },
    { label: 'Free Move',         verb: 'SPIN_METHOD_AGAIN',params: {},               weight: 10, desc: 'Spin the Method Wheel again and move again' },
    { label: 'Windfall',          verb: 'SECONDARY_RANDOM_GAIN', params: { units: 5 }, weight: 12, desc: '+5 of a random secondary currency' },
    { label: 'Tax Refund',        verb: 'GOLD_DELTA',       params: { amount: 100 },  weight: 15, desc: '+100 Gold' },
    { label: 'Eat The Rich',      verb: 'STEAL_FROM_RICHEST', params: { amount: 100 }, weight: 10, desc: 'Take 100 Gold from the richest player' },
    { label: 'Portal Pass',       verb: 'TELEPORT_CHOICE',  params: {},               weight: 8,  desc: 'Teleport to any tile you choose (tile resolves)' },
    { label: 'Nothing But Vibes', verb: 'NOTHING',          params: {},               weight: 7,  desc: 'Good vibes only. No mechanical effect.' },
    { label: 'Mystery Egg',       verb: 'EGG_GRANT',        params: { consolation: 50 }, weight: 5, desc: 'A free pet egg hatches (full team: +50 Power instead)' },
    { label: 'Power Surge',       verb: 'POWER_DELTA',      params: { amount: 40 },   weight: 8,  desc: '+40 Power ⚡' },
  ],

  // ── Tab 8: Wheel_Bad ───────────────────────────────────────────
  Wheel_Bad: [
    { label: 'Go to Jail',    verb: 'GO_TO_JAIL',       params: {},               weight: 8,  desc: 'Jail 1. Consumes a Pardon if held.' },
    { label: 'Tax Audit',     verb: 'GOLD_DELTA',       params: { amount: -200 }, weight: 15, desc: '−200 Gold' },
    { label: 'Pickpocket',    verb: 'GOLD_DELTA',       params: { amount: -100 }, weight: 15, desc: '−100 Gold' },
    { label: 'Market Crash',  verb: 'PCT_GOLD',         params: { pct: -20 },     weight: 8,  desc: 'Lose 20% of your Gold' },
    { label: 'Cursed',        verb: 'BUFF_NEXT_WIN',    params: { mult: 0.5 },    weight: 10, desc: 'Next game win pays 0.5×' },
    { label: 'Dropped It',    verb: 'SECONDARY_LOSE_RANDOM', params: { units: 5 }, weight: 10, desc: 'Lose 5 of a random secondary you hold' },
    { label: 'Forced March',  verb: 'FORCED_MARCH',     params: { steps: 3 },     weight: 10, desc: 'GM marches you 3 tiles, GM picks directions. Tile resolves.' },
    { label: 'Charity Case',  verb: 'PAY_TO_POOREST',   params: { amount: 100 },  weight: 10, desc: 'Pay 100 Gold to the poorest player' },
    { label: 'The Collector', verb: 'COLLECTOR',        params: { perTurn: 50, turns: 3 }, weight: 6, desc: '−50 Gold at the start of your next 3 turns' },
    { label: 'Nothing',       verb: 'NOTHING',          params: {},               weight: 8,  desc: 'The wheel spares you. This time.' },
    { label: 'Wild Encounter', verb: 'WILD_ENCOUNTER',  params: { consolation: 20 }, weight: 7, desc: 'A wild pet attacks your active pet. Win and it may join you.' },
    { label: 'Power Drain',   verb: 'POWER_DELTA',      params: { amount: -30 },  weight: 5,  desc: '−30 Power ⚡' },
  ],

  // ── Tab 9: Wheel_Jail (per-tier weights, §5.4 — sums 100/tier) ─
  Wheel_Jail: [
    { label: 'Escape',           verb: 'JAIL_RELEASE',   params: {}, weights: { 1: 25, 2: 18, 3: 12, 4: 8 },  desc: 'Free immediately, resume next turn' },
    { label: 'Reduced Sentence', verb: 'JAIL_TIER_DOWN', params: {}, weights: { 1: 15, 2: 15, 3: 15, 4: 15 }, desc: 'Drop one tier (at T1: free)' },
    { label: 'Skip Next Spin',   verb: 'JAIL_SKIP_SPIN', params: {}, weights: { 1: 10, 2: 10, 3: 10, 4: 10 }, desc: 'No spin next turn, sit quietly' },
    { label: 'Commissary',       verb: 'COMMISSARY',     params: { t12: 100, t34: 200 }, weights: { 1: 10, 2: 10, 3: 8, 4: 8 }, desc: '+100 Gold (T1/T2) / +200 (T3/T4)' },
    { label: 'Yard Time',        verb: 'BUFF_NEXT_WIN',  params: { mult: 1.5 }, weights: { 1: 5, 2: 5, 3: 5, 4: 5 }, desc: 'Next post-jail game win pays 1.5×' },
    { label: 'Go Deeper',        verb: 'JAIL_ESCALATE',  params: {}, weights: { 1: 15, 2: 18, 3: 20, 4: 10 }, desc: '+1 tier (hard cap 1/spin; no effect at T4)' },
    { label: 'Solitary',         verb: 'JAIL_SPIN_TWICE',params: {}, weights: { 1: 0, 2: 0, 3: 0, 4: 12 },   desc: 'T4 only: spin twice next turn' },
    { label: 'Extended',         verb: 'SKIP_TURN',      params: {}, weights: { 1: 8, 2: 10, 3: 12, 4: 14 }, desc: 'Lose next turn entirely' },
    { label: 'Shakedown',        verb: 'SHAKEDOWN',      params: { t12: -100, t3: -200 }, weights: { 1: 8, 2: 10, 3: 12, 4: 12 }, desc: '−100 (T1/T2) / −200 (T3) / lose highest secondary (T4)' },
    { label: 'Nothing',          verb: 'NOTHING',        params: {}, weights: { 1: 4, 2: 4, 3: 6, 4: 6 },    desc: 'The wheel mocks you' },
  ],

  // ── Tab 10: Wheel_Battle (contest pool: Digital + Physical) ────
  Wheel_Battle: [
    { label: 'Pet Battle', pool: 'Digital', weight: 10, spinCategory: false, petBattle: true },
    { label: 'Rock Paper Scissors (Bo3)', pool: 'Physical', weight: 14 },
    { label: 'Coin Flip',                 pool: 'Digital',  weight: 12, auto: 'coin' },
    { label: 'High Card',                 pool: 'Digital',  weight: 12, auto: 'card' },
    { label: 'Dice Duel (high roll)',     pool: 'Digital',  weight: 12, auto: 'dice' },
    { label: 'Name 10 → Category Wheel',  pool: 'Physical', weight: 12, spinCategory: true },
    { label: 'Staring Contest',           pool: 'Physical', weight: 8 },
    { label: 'Thumb War',                 pool: 'Physical', weight: 8 },
    { label: 'Speed Count to 21',         pool: 'Physical', weight: 8 },
    { label: 'Trivia Face-Off (GM asks)', pool: 'Physical', weight: 8 },
    { label: "GM's Choice",               pool: 'Any',      weight: 6 },
  ],

  // ── Tab 11: Wheel_Category (for Name 10) ───────────────────────
  Wheel_Category: [
    { label: 'Movies', weight: 10 }, { label: 'Animals', weight: 10 },
    { label: 'Foods', weight: 10 }, { label: 'Video Games', weight: 10 },
    { label: 'Countries', weight: 8 }, { label: 'Songs', weight: 8 },
    { label: 'Brands', weight: 8 }, { label: 'TV Shows', weight: 8 },
    { label: 'Athletes', weight: 7 }, { label: 'Cocktails', weight: 7 },
    { label: 'Board Games', weight: 7 }, { label: 'Celebrities', weight: 7 },
  ],

  // ── Tab 12: Wheel_BuyIn (mechanism picker; GM adjudicates amount) ─
  Wheel_BuyIn: [
    { label: 'Flat Fee',            weight: 18, mech: 'flat', desc: 'GM names a Gold price. Pay it.' },
    { label: 'Percentage Tithe',    weight: 14, mech: 'tithe', params: { pct: 10 }, desc: 'Pay 10% of your current Gold (GM may adjust)' },
    { label: 'Auction',             weight: 14, mech: 'auction', desc: 'Your currencies go up for auction (per-currency lots)' },
    { label: 'Loan Shark',          weight: 12, mech: 'loan', desc: 'Borrow from the house; GM sets terms + Collector timer' },
    { label: 'Charity',             weight: 10, mech: 'charity', desc: 'The richest player pays your buy-in. They will remember.' },
    { label: 'Work Release',        weight: 10, mech: 'work', desc: 'Skip your next turn instead of paying' },
    { label: 'Secondary Sacrifice', weight: 12, mech: 'sacrifice', desc: 'Hand over your highest-value secondary stack' },
    { label: 'Double Down',         weight: 10, mech: 'double', desc: 'Pay 2× the flat fee; your next win pays 2×' },
  ],

  // ── Tab 13: Themes (CSS custom-property tokens, hot-swappable) ─
  Themes: [
    { id: 'noir',    name: 'Casino Noir' },
    { id: 'vapor',   name: 'Neon Vapor' },
    { id: 'felt',    name: 'Royal Felt' },
    { id: 'riviera', name: 'Sunset Riviera' },
  ],

  // ── Auction (§8): opening bid = openingPct × the lot's GoldRate value; each raise ≥ minIncrement;
  // the GM calls "going once / twice / sold" (callsToSell). Lots default to Config.AuctionDefaultLots.
  Auction: { minIncrement: 10, openingPct: 0.25, callsToSell: 3 },

  // ── Loans (Phase 7) — the Loan Shark's table terms. The GM can override interest/term per loan.
  // Interest is flat, added up front. Term = the borrower's own turns. On default: one-time penalty,
  // then the Collector garnishes garnishPerTurn at the start of every turn until the debt is clear.
  Loans: { enabled: true, minPrincipal: 100, maxPrincipal: 2000, interestPct: 25, termTurns: 4, penaltyPct: 20, garnishPerTurn: 150, maxOpenLoans: 2 },

  // ── Pets + Power Level (Phase 7 side game). Power ⚡ is earned from main-game events (gain.*) and
  // spent on eggs, training and healing. PetSpecies: [] = the 12 built-in species (see pets.js); add rows
  // { id, name, emoji, element, rarity, base: {str,dex,con,int,wis,cha}, grow: [stat, stat] } to replace them.
  Pets: { enabled: true, maxPets: 3, eggCost: 100, reviveCost: 25, xpPerPower: 2, maxLevel: 20, bigWinMult: 5,
    gain: { turn: 2, gameWin: 10, gameBigWin: 25, battleWin: 20, jailOut: 10, jailIn: 5, petBattleWin: 30, bossWin: 60, sessionStart: 50 } },
  PetSpecies: [],
  // Pet battles: d20 + proficiency + ability mod vs AC. PetBosses: [] = the 5 built-in bosses (petbattle.js);
  // rows { id, name, emoji, element, level, stats:{…}, rewardGold } replace them.
  PetBattle: { maxRounds: 30, bossHpScale: 1.1, strongMult: 1.5, resistMult: 0.75, winXpBase: 20, winXpPerLevel: 6, loseXp: 10, minWager: 0, dropChance: 0.3 },
  PetBosses: [],
  // Raids: 2–6 pets vs one boss. Boss HP grows by hpPerMember per extra pet; each winner gets goldShare × the boss reward.
  // RaidBosses: [] = two built-in raid-only bosses (raid.js) on top of the normal boss list.
  Raid: { minParty: 2, maxParty: 6, hpPerMember: 0.75, goldShare: 0.6, maxRounds: 40 },
  RaidBosses: [],
  // PetShop: [] = built-in goods sold for Gold at Shop tiles (Pet Egg 400, Potion 100, XP Candy 150) plus five
  // held items (250–350): Sharp Fang, Hard Shell, Focus Band, Rally Berry, Lucky Charm. Bosses drop them 30% of the time.
  PetShop: [],

  // ── SoundPacks (Phase 6) — optional per-theme overrides of the built-in synth voices.
  // Row: { themeId, wave: sine|square|triangle|sawtooth, root: Hz, tempo: seconds per note }. Empty = built-ins.
  SoundPacks: [],

  // ── Tab 14: PowerUps (§6.2 — catalog exists now; sold in Phase 4) ─
  PowerUps: [
    { id: 'reroll',    name: 'Edge: Reroll',  type: 'Wheel Mod',   effect: 'Reroll any one wheel spin, once', price: 300, duration: 'Held until used', maxHeld: 2, active: true },
    { id: 'fork',      name: 'Edge: Fork',    type: 'Wheel Mod',   effect: 'Spin twice, pick the outcome, once', price: 500, duration: 'Held until used', maxHeld: 1, active: true },
    { id: 'nudge',     name: 'Nudge',         type: 'Wheel Mod',   effect: '+50% weight to one named outcome on your next spin', price: 250, duration: 'Next spin', maxHeld: 1, active: true },
    { id: 'bribe',     name: 'Bribe',         type: 'Jail Utility',effect: 'Your next jail buyout costs 50%', price: 200, duration: 'Held until used', maxHeld: 1, active: true },
    { id: 'lockpick',  name: 'Lockpick',      type: 'Jail Utility',effect: '+15 weight to Escape on your next Jail Wheel spin', price: 150, duration: 'Next jail spin', maxHeld: 1, active: true },
    { id: 'hedge',     name: 'Hedge',         type: 'Stabilizer',  effect: 'Lock one shop rate for yourself for 5 turns', price: 200, duration: '5 turns', maxHeld: 1, active: true },
    { id: 'floor',     name: 'Floor',         type: 'Stabilizer',  effect: 'Next multi-currency win pays minimum 1×', price: 250, duration: 'Next game', maxHeld: 1, active: true },
    { id: 'highroller',name: 'High Roller',   type: 'Amplifier',   effect: 'Next game: gains AND losses ×2', price: 100, duration: 'Next game', maxHeld: 1, active: true },
  ],

  // ── Tab 15: ShopConfig ─────────────────────────────────────────
  ShopConfig: {
    rateMin: 0.5,
    rateMax: 2.0,
    currenciesPerVisit: 3,
    ratePersistence: 'PER_SESSION_CACHED', // roll once per currency per session
  },

  // ── Tab 16: Stakes (IRL bets, record-only, no in-game effect) ──
  Stakes: [], // rows: { ts, players, description, settled }
};

// Verb set reference (universal wheel verbs the executor understands):
// GOLD_DELTA PCT_GOLD NOTHING GO_TO_JAIL JAIL_ESCALATE JAIL_RELEASE JAIL_TIER_DOWN
// JAIL_SKIP_SPIN JAIL_SPIN_TWICE COMMISSARY SHAKEDOWN SKIP_TURN BUFF_NEXT_WIN
// PARDON_GRANT SPIN_METHOD_AGAIN SECONDARY_RANDOM_GAIN SECONDARY_LOSE_RANDOM
// STEAL_FROM_RICHEST PAY_TO_POOREST COLLECTOR TELEPORT_RANDOM TELEPORT_CHOICE
// FORCED_MARCH VOID_LONG_WAY VOID_EXILE VOID_REWIND ADJUDICATE
