/**
 * Every user-visible string in the meta screens, in one place.
 *
 * Handoff §7 — "no renamed anything". The prototype's copy is a deliberate mix of English
 * and Indonesian and it ships unchanged: `BARU!`, `Arena tertinggi!`,
 * `Sudah diambil — balik besok!`, `…tersambung`, `…didapat!`, `SUARA: ON/OFF`,
 * `Progress tersimpan otomatis di perangkat ini.` and `hms()`'s `3j 0m` hour suffix (that
 * one lives in `@crown/shared`'s `hms`). Centralising them here means a future localisation
 * pass touches one file instead of ten — it is NOT a licence to reword anything now.
 *
 * Three groups of strings are *new*, because the behaviour behind them is new. They are
 * marked NEW below:
 *   - wallet: the demo-address fallback is gone, so the flow has to say what went wrong;
 *   - errors: the prototype could not fail (everything was local), the client now can;
 *   - result: a server-voided match has no prototype equivalent.
 */

export const STR = {
  /* ------------------------------------------------------------------- home */
  home: {
    nextArena: (t: number): string => 'Next arena: ' + t + ' 🏆',
    topArena: 'Arena tertinggi!',
    trophies: (n: number): string => n + ' 🏆',
    /** `avg` is already `.toFixed(1)`-formatted by the caller. */
    deckAvg: (avg: string): string => 'Avg ' + avg + ' ⚡',
  },

  /* ----------------------------------------------------------------- chests */
  chests: {
    free: 'Free Chest',
    /** `left` is `hms()` output — "3j 0m", "12m", "40d". */
    countdown: (left: string): string => left + ' more',
    ready: 'Ready to open!',
    locked: 'Locked',
    open: 'OPEN',
    battleReward: 'Battle reward',
    emptySlot: 'Empty Slot',
    winABattle: 'Win a battle',
    play: 'PLAY',
    waiting: (n: number): string => n + ' chests waiting',
    hintNone: 'Win battles to earn chests',
  },

  /* ------------------------------------------------------------------ cards */
  cards: {
    battleDeck: 'BATTLE DECK',
    collection: 'COLLECTION',
    count: (owned: number, total: number): string => owned + ' / ' + total,
    locked: '🔒',
    level: (lv: number, ready: boolean): string => 'Lv ' + lv + (ready ? ' ↑' : ''),
    notUnlocked: 'Not unlocked yet — find it in a chest!',
    levelLine: (lv: number): string => 'Level ' + lv,
    progress: (cnt: number, need: string): string => cnt + ' / ' + need,
    max: 'MAX',
    typeSpell: 'Spell',
    typeBuild: 'Building',
    typeTroop: 'Troop',
    statDamage: 'Damage',
    statRadius: 'Radius',
    statTowerDamage: 'Damage tower',
    statHp: 'HP',
    statDps: 'DPS',
    statRange: 'Range',
    statTargets: 'Targets',
    statCount: 'Count',
    melee: 'Melee',
    tiles: (n: number): string => n + ' tile',
    units: (n: number): string => n + ' unit',
    targetsBoth: 'Ground + Air',
    targetsBuild: 'Building',
    targetsGround: 'Ground',
    upgrade: (cost: string): string => '⬆ UPGRADE · 🪙' + cost,
    swapDeck: 'SWAP DECK',
    swapSlot: (slot: number): string => 'SWAP SLOT ' + (slot + 1),
    pickSlotTitle: 'PICK A SLOT',
    pickSlotSub: 'Which card do you want to replace?',
    alreadyInDeck: 'That card is already in your deck',
    pickFromCollection: (slot: number): string =>
      'Pick a card from your collection for slot ' + (slot + 1),
    addedToDeck: (name: string): string => name + ' added to deck!',
    upgraded: (name: string, lv: number): string => name + ' upgraded to level ' + lv + '!',
  },

  /* ------------------------------------------------------------------- shop */
  shop: {
    title: 'CHEST SHOP',
    balance: (gold: string, gem: string): string => '🪙 ' + gold + ' · 💎 ' + gem,
    dropRates: 'DROP RATES',
    goldPackDesc: 'Added straight to your balance',
    chestDesc: (cards: number, lo: number, hi: number): string =>
      cards + ' cards · ' + lo + '–' + hi + ' gold',
    price: (cur: 'gold' | 'gem', amount: string): string => (cur === 'gold' ? '🪙 ' : '💎 ') + amount,
    rateCommon: 'Common — 75.5%',
    rateRare: 'Rare — 20%',
    rateEpic: 'Epic — 4%',
    rateLegendary: 'Legendary — 0.5%',
    guarantees:
      'Golden guarantees 1+ Rare · Magical guarantees 1 Epic · Legendary guarantees 1 Legendary.',
    goldBought: (gold: string): string => '+' + gold + ' gold',
  },

  /* ------------------------------------------------------------------ gacha */
  chest: {
    tapHint: 'Tap the chest until it opens',
    tap: 'TAP!',
    done: 'NICE!',
    isNew: 'BARU!',
    count: (n: number): string => '×' + n,
    gold: (n: string): string => '🪙 +' + n,
    gem: (n: number): string => '💎 +' + n,
    /** NEW — the roll happens on the server now, so it can fail. */
    failed: 'Could not open that chest. Nothing was spent.',
  },

  /* ----------------------------------------------------------------- quests */
  quests: {
    title: 'DAILY QUESTS',
    resets: 'Resets daily',
    careerTotals: 'CAREER TOTALS',
    troopsDeployed: 'TROOPS DEPLOYED',
    towerDamage: 'TOWER DAMAGE',
    towersDestroyed: 'TOWERS DESTROYED',
    chestOpened: 'CHEST OPENED',
    progress: (prog: string, goal: string, gold: number, gem: number): string =>
      prog + ' / ' + goal + ' · 🪙' + gold + ' 💎' + gem,
    claimed: '✓',
    claim: 'CLAIM',
    notYet: '—',
    reward: (gold: number, gem: number): string => '+' + gold + ' gold, +' + gem + ' gem',
  },

  /* ------------------------------------------------------------------ login */
  login: {
    title: 'LOGIN REWARDS',
    streak: (d: number): string => 'Streak ' + d + 'd',
    claimDay: (day: number): string => '🎁 CLAIM DAY ' + (day + 1),
    alreadyClaimed: 'Sudah diambil — balik besok!',
    day: (i: number): string => 'DAY ' + (i + 1),
    claimedToast: (name: string): string => 'Claimed: ' + name,
    connectWallet: 'CONNECT WALLET',
    linked: (kind: string): string =>
      'Wallet ' + kind + ' tersambung. Airdrop $CROWN dikirim ke sini.',
    pitch:
      'Link a wallet to claim a one-time 100 💎 bonus and become eligible for the $CROWN airdrop.',
    connectButton: '🔗 CONNECT WALLET',
  },

  /* ----------------------------------------------------------------- wallet */
  wallet: {
    title: 'WALLET',
    connectTitle: 'CONNECT WALLET',
    bonusSub: 'One-time 100 💎 bonus',
    metamask: 'MetaMask',
    metamaskSub: 'EVM · Robinhood Chain / ETH / Base',
    phantom: 'Phantom',
    phantomSub: 'Solana',
    walletconnect: 'WalletConnect',
    walletconnectSub: 'All mobile wallets',
    /**
     * NEW — replaces "Kalau extension gak kedeteksi, dibuatin demo address biar flow-nya
     * tetap jalan." A demo address cannot be signed, so it cannot be linked; promising one
     * would be a lie. Same register as the line it replaces.
     */
    needExtension: 'Butuh wallet extension. Kalau gak kedeteksi, connect-nya gak bisa jalan.',
    /**
     * Kept verbatim even though the save now lives on the server — handoff §7 forbids
     * rewording. Flagged in the port report.
     */
    localNote:
      'All progress is saved locally. Your wallet is only used for identity and future $CROWN airdrop claims.',
    disconnect: 'DISCONNECT',
    connected: 'Wallet connected! +100 💎',
    /**
     * The prototype stored the *brand* the player tapped ('MetaMask', 'Phantom',
     * 'WalletConnect') and printed it. The server stores the chain instead
     * (`walletKind: 'evm' | 'solana'`), because that is what it verified — it cannot know
     * which app produced the signature. So "Wallet MetaMask tersambung." became
     * "Wallet EVM tersambung.": same sentence, honest noun.
     */
    kindLabel: (kind: string): string => (kind === 'evm' ? 'EVM' : kind === 'solana' ? 'Solana' : kind),
    /* NEW — failure copy for the real flow. */
    noMetaMask: 'MetaMask not detected — install the extension and reload.',
    noPhantom: 'Phantom not detected — install the extension and reload.',
    noInjected: "No wallet detected — open this page inside your wallet's browser.",
    noAccount: 'Wallet returned no account.',
    cancelled: 'Wallet connection cancelled.',
    signFailed: 'Could not sign the message.',
    linkFailed: 'Wallet link failed.',
    unlinkFailed: 'Could not disconnect that wallet.',
  },

  /* --------------------------------------------------------------- settings */
  settings: {
    title: 'PROFILE',
    sub: 'Change your name & avatar',
    sfxOn: '🔊 SUARA: ON',
    sfxOff: '🔇 SUARA: OFF',
    save: 'SAVE',
    note: 'Progress tersimpan otomatis di perangkat ini.',
    saveFailed: 'Could not save your profile.',
  },

  /* ------------------------------------------------------------ matchmaking */
  mm: {
    title: 'FINDING OPPONENT',
    connecting: 'Connecting to arena…',
    found: 'Opponent found!',
    vs: 'VS',
    unknownName: '…',
    unknownTrophies: '—',
    trophies: (n: number): string => '🏆 ' + n,
    failed: 'Could not start a match.',
  },

  /* ----------------------------------------------------------------- result */
  result: {
    win: 'VICTORY!',
    lose: 'DEFEAT',
    draw: 'DRAW',
    you: 'YOU',
    rival: 'RIVAL',
    vs: 'vs',
    crownsMe: (n: number): string => n + ' 👑',
    crownsThem: (n: number): string => '👑 ' + n,
    /** The trophy row is `🏆 before → <b>after</b>`; the `<b>` is coloured by sign. */
    trophyBefore: (before: number): string => '🏆 ' + before + ' → ',
    goldDelta: (gold: number): string => '🪙 +' + gold,
    chestEarned: (name: string): string => name + ' didapat!',
    home: 'HOME',
    again: 'PLAY AGAIN',
    /** NEW — the prototype had no server, so a match could never be rejected. */
    voided: (reason: string): string => 'Match voided (' + reason + ') — no rewards paid.',
  },

  /* ------------------------------------------------------------ shared/error */
  err: {
    /** NEW — everything below is server-era. */
    offline: 'You are offline — try again in a moment.',
    tooFast: 'Slow down a moment and try again.',
    generic: 'Something went wrong. Try again.',
  },
} as const;

/**
 * HTML-escape a value before it goes into an `innerHTML` template.
 *
 * The prototype interpolated `S.name` and `S.wallet` raw (L1413, L2864, L2893). Both are
 * player-controlled, so a name of `<img onerror=…>` executed on the player's own device.
 * For every ordinary name this produces byte-identical output; it only differs for input
 * that was a bug to render in the first place.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
