/**
 * Barrel for the meta screens. `main.ts` imports everything it needs from here; the battle
 * screen imports `showResult` and the two bridge setters.
 *
 * Boot order `main.ts` has to honour: `initLanding(onEnter)` once, then
 * `refreshHeader(); setTab('home'); markDots();`. Everything else — the navbar delegate, the
 * BATTLE button, the wallet and avatar buttons — binds itself lazily the first time the
 * screen it belongs to renders, and is guarded so it binds exactly once (B1).
 */
export { setTab, markDots, currentTab } from '../ui/tabs';
export type { TabName } from '../ui/tabs';

export { refreshHeader, refreshHome, renderChests, drawMiniArena, initLanding, homeTemplate } from './home';
export { renderCardsTab, cardNode, openCardDetail, pickSlot } from './cards';
export type { CardNodeOpts } from './cards';
export { renderShop } from './shop';
export { renderQuests } from './quests';
export { renderLogin } from './login';
export { openWallet } from './wallet';
export { openSettings } from './settings';
export { openChestFlow } from './chest';
export type { ChestFlow } from './chest';
export { findMatch } from './matchmaking';
export type { BattleStarter } from './matchmaking';
export { showResult } from './result';
export type { ResultActions } from './result';
export { showScreen, leaveBattle } from './battleBridge';
export { STR, esc } from './strings';
export { apiMessage } from './errors';
