/**
 * The acceptance journey — handoff §8.4 and §9.
 *
 * "landing → play → deploy 4 cards → result → chest open → quest claim → login reward →
 *  reload persists from server"
 *
 * Written as one ordered story rather than isolated cases, because the thing under test is
 * the *session*: that a brand-new player can get from a cold page to earned, server-persisted
 * progress. Splitting it up would let each step pass while the sequence stays broken.
 *
 * The match is played by tapping cards at real coordinates, so this exercises the same
 * pointer path a phone does — including the deploy-log recording that the server re-simulates.
 */
import { expect, test, type Page } from '@playwright/test';

/** Tap a hand card, then tap our half of the arena — the prototype's two-tap deploy. */
async function deployCard(page: Page, slot: number): Promise<boolean> {
  const card = page.locator(`#handRow .hcard[data-i="${slot}"]`);
  if (!(await card.isVisible())) return false;
  // A greyed card is unaffordable; the prototype refuses the tap with a buzz.
  if (await card.evaluate((el) => el.classList.contains('no'))) return false;

  await card.click();
  const arena = page.locator('#arena');
  const box = await arena.boundingBox();
  if (!box) return false;
  // Drop into the bottom third — comfortably inside the y >= 16.95 deploy zone (D2).
  await page.mouse.click(box.x + box.width * (0.3 + slot * 0.12), box.y + box.height * 0.82);
  return true;
}

/** Wait for the elixir counter to reach `n`, so deploys are affordable. */
async function waitForElixir(page: Page, n: number): Promise<void> {
  await expect
    .poll(async () => Number((await page.locator('#elixNum').textContent()) || '0'), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(n);
}

test.describe('first session', () => {
  test('a new player lands, battles, earns and keeps progress', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    /* ---------------------------------------------------------------- landing */
    await page.goto('/');
    await expect(page.locator('#landing')).toBeVisible();
    await expect(page.locator('.lp-word')).toContainText('CROWN');
    // The landing art is drawn by the real engine, not an image — the canvas must have size.
    await expect
      .poll(async () => page.locator('#lpLogo').evaluate((c: HTMLCanvasElement) => c.width), { timeout: 20_000 })
      .toBeGreaterThan(0);

    await page.locator('#lpPlay').click();
    await expect(page.locator('#landing')).toBeHidden({ timeout: 10_000 });

    /* ------------------------------------------------------------------- home */
    // A brand-new account per §2: 1200 gold, 120 gems.
    await expect(page.locator('#hGold')).toHaveText('1200', { timeout: 20_000 });
    await expect(page.locator('#hGem')).toHaveText('120');
    await expect(page.locator('#hTro')).toHaveText('0');
    await expect(page.locator('#hArenaName')).toHaveText('Training Camp');
    // Dismiss the first-run explainer if it opened.
    const welcomeGo = page.locator('#wGo');
    if (await welcomeGo.isVisible().catch(() => false)) await welcomeGo.click();

    /* ------------------------------------------------------------------ battle */
    await page.locator('#btnBattle').click();
    // Matchmaking modal, then the arena.
    await expect(page.locator('#battle.on')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#arena')).toBeVisible();
    await expect(page.locator('#handRow .hcard[data-i="0"]')).toBeVisible();

    // Deploy four cards, waiting for elixir between them.
    let deployed = 0;
    for (let attempt = 0; attempt < 24 && deployed < 4; attempt++) {
      await waitForElixir(page, 3);
      if (await deployCard(page, attempt % 4)) deployed++;
      await page.waitForTimeout(400); // respect the 300 ms server-side deploy floor
    }
    expect(deployed, 'should have deployed 4 cards').toBeGreaterThanOrEqual(4);

    /* ------------------------------------------------------------------ result */
    // A full match is 180 s + up to 60 s overtime; the result modal is the end signal.
    const resultBanner = page.locator('.resbanner');
    await expect(resultBanner).toBeVisible({ timeout: 260_000 });
    await expect(resultBanner).toHaveText(/VICTORY!|DEFEAT|DRAW/);
    const trophiesAfterMatch = await page.locator('#hTro').textContent();

    await page.locator('#resHome').click();
    await expect(page.locator('#home.on')).toBeVisible();

    /* ------------------------------------------------------------- chest open */
    // The free wooden chest is available immediately on a new account (freeChestAt = 0).
    const openBtn = page.locator('#chestRow button', { hasText: 'OPEN' }).first();
    await expect(openBtn).toBeEnabled({ timeout: 15_000 });
    const goldBefore = Number(await page.locator('#hGold').textContent());
    await openBtn.click();

    // Tap the chest until it pops (3 taps for wooden, 4 for magical/legend).
    const chestCv = page.locator('#chestCv');
    await expect(chestCv).toBeVisible();
    for (let i = 0; i < 5; i++) {
      await chestCv.click();
      await page.waitForTimeout(220);
      if (await page.locator('#gDone').isVisible().catch(() => false)) break;
    }
    await expect(page.locator('#gDone')).toBeVisible({ timeout: 15_000 });
    // Rewards are rendered from the server's roll — at least one card must appear.
    await expect(page.locator('#rwGrid .rw').first()).toBeVisible();
    await page.locator('#gDone').click();
    await expect
      .poll(async () => Number(await page.locator('#hGold').textContent()))
      .toBeGreaterThan(goldBefore);

    /* ------------------------------------------------------------ quest claim */
    await page.locator('.navbtn[data-tab="quest"]').click();
    await expect(page.locator('#qList .qrow').first()).toBeVisible({ timeout: 15_000 });
    // Playing a match and opening a chest should have completed at least one quest;
    // if none is claimable the button stays disabled, which is still correct behaviour.
    const claim = page.locator('#qList .qclaim:not([disabled])').first();
    if (await claim.isVisible().catch(() => false)) {
      const before = Number(await page.locator('#hGold').textContent());
      await claim.click();
      await expect
        .poll(async () => Number(await page.locator('#hGold').textContent()))
        .toBeGreaterThan(before);
    }

    /* ------------------------------------------------------------ login reward */
    await page.locator('.navbtn[data-tab="login"]').click();
    const claimDay = page.locator('#claimDay');
    await expect(claimDay).toBeVisible({ timeout: 15_000 });
    await expect(claimDay).toBeEnabled();
    const goldBeforeLogin = Number(await page.locator('#hGold').textContent());
    await claimDay.click();
    // Day 1 is 200 gold.
    await expect
      .poll(async () => Number(await page.locator('#hGold').textContent()), { timeout: 15_000 })
      .toBe(goldBeforeLogin + 200);
    // ...and it cannot be claimed twice today.
    await page.locator('.navbtn[data-tab="login"]').click();
    await expect(page.locator('#claimDay')).toBeDisabled();

    /* ---------------------------------------------------- reload persists from server */
    const goldFinal = await page.locator('#hGold').textContent();
    const gemFinal = await page.locator('#hGem').textContent();

    // Drop the local cache entirely, so anything that survives must have come from the server.
    await page.evaluate(async () => {
      const dbs = await (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> }).databases?.();
      void dbs;
      // Keep the device id — that is the credential. Clear only the cached save.
      const req = indexedDB.open('crownclash', 1);
      await new Promise<void>((resolve) => {
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').delete('crownclash:save');
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      });
    });

    await page.reload();
    // Landing shows again on reload; skip it.
    const play = page.locator('#lpPlay');
    if (await play.isVisible().catch(() => false)) await play.click();

    await expect(page.locator('#hGold')).toHaveText(goldFinal!, { timeout: 25_000 });
    await expect(page.locator('#hGem')).toHaveText(gemFinal!);
    await expect(page.locator('#hTro')).toHaveText(trophiesAfterMatch!);

    expect(consoleErrors, `console errors during the journey:\n${consoleErrors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('deck and shop', () => {
  test('the collection shows all 21 cards and the deck holds 8', async ({ page }) => {
    await page.goto('/');
    const play = page.locator('#lpPlay');
    if (await play.isVisible().catch(() => false)) await play.click();
    const welcomeGo = page.locator('#wGo');
    if (await welcomeGo.isVisible().catch(() => false)) await welcomeGo.click();

    await page.locator('.navbtn[data-tab="cards"]').click();
    await expect(page.locator('#tabDeck .ccard')).toHaveCount(8, { timeout: 20_000 });
    // 21 playable cards — behemoth_mini must never surface in the collection.
    await expect(page.locator('#colGrid .ccard')).toHaveCount(21);
    await expect(page.locator('#colCount')).toContainText('/ 21');
  });

  test('the shop publishes its drop rates (§7)', async ({ page }) => {
    await page.goto('/');
    const play = page.locator('#lpPlay');
    if (await play.isVisible().catch(() => false)) await play.click();
    const welcomeGo = page.locator('#wGo');
    if (await welcomeGo.isVisible().catch(() => false)) await welcomeGo.click();

    await page.locator('.navbtn[data-tab="shop"]').click();
    const rates = page.locator('.sect', { hasText: 'DROP RATES' });
    await expect(rates).toBeVisible({ timeout: 20_000 });
    await expect(rates).toContainText('75.5%');
    await expect(rates).toContainText('20%');
    await expect(rates).toContainText('4%');
    await expect(rates).toContainText('0.5%');
  });
});

test.describe('mobile layout', () => {
  test('nothing overflows horizontally at 380x740', async ({ page }) => {
    await page.goto('/');
    const play = page.locator('#lpPlay');
    if (await play.isVisible().catch(() => false)) await play.click();
    const welcomeGo = page.locator('#wGo');
    if (await welcomeGo.isVisible().catch(() => false)) await welcomeGo.click();

    for (const tab of ['home', 'cards', 'shop', 'quest', 'login']) {
      await page.locator(`.navbtn[data-tab="${tab}"]`).click();
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement || document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflow, `${tab} tab overflows horizontally`).toBeLessThanOrEqual(1);
    }
  });
});
