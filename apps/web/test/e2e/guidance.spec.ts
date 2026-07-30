/**
 * The two screens added so a player can tell what to do next.
 *
 * Counter rows answer "what beats this", which the prototype never said anywhere. The
 * leaderboard answers "what are the trophies for", which it also never said — `/api/leaderboard`
 * existed from the first commit and nothing in the client ever called it.
 *
 * Driven through the real UI rather than unit-tested because both are wiring: the model behind
 * the counter rows already has its own tests in packages/shared, and what can break here is
 * the render, the tap target and the fetch.
 */
import { expect, test, type Page } from '@playwright/test';

async function enterApp(page: Page): Promise<void> {
  await page.goto('/');
  const play = page.locator('#lpPlay');
  if (await play.isVisible().catch(() => false)) await play.click();
  await expect(page.locator('#hGold')).toHaveText('1200', { timeout: 25_000 });
  const welcomeGo = page.locator('#wGo');
  if (await welcomeGo.isVisible().catch(() => false)) await welcomeGo.click();
}

/**
 * Open a card's detail sheet from the collection grid.
 *
 * By index rather than by name: the grid renders portraits onto canvases, so there is no text
 * in it to select on. Which card it lands on does not matter — every card in the game has at
 * least one counter row, and packages/shared/test/counters.test.ts is what asserts that.
 */
async function openCard(page: Page, index = 0): Promise<void> {
  await page.locator('.navbtn[data-tab="cards"]').click();
  await expect(page.locator('#colGrid .ccard').nth(index)).toBeVisible({ timeout: 20_000 });
  await page.locator('#colGrid .ccard').nth(index).click();
}

test.describe('card counters', () => {
  test.setTimeout(120_000);

  test('the card sheet says what beats it and what it beats', async ({ page }) => {
    await enterApp(page);
    await openCard(page);

    const modal = page.locator('#modal');
    await expect(modal.locator('.mublock')).toBeVisible({ timeout: 20_000 });

    // Whichever card opened, it must carry at least one row, and every entry must be a real
    // card with a portrait drawn into it rather than an empty button.
    const entries = modal.locator('.mu');
    expect(await entries.count()).toBeGreaterThan(0);
    await expect(entries.first().locator('canvas')).toBeVisible();
    await expect(entries.first().locator('span')).not.toBeEmpty();

    const labels = await modal.locator('.mulabel').allTextContents();
    expect(labels.join(' ')).toMatch(/STRONG AGAINST|WEAK AGAINST/);
  });

  test('tapping a counter walks to that card instead of stacking sheets', async ({ page }) => {
    await enterApp(page);
    await openCard(page);

    const modal = page.locator('#modal');
    await expect(modal.locator('.mu').first()).toBeVisible({ timeout: 20_000 });
    const target = (await modal.locator('.mu span').first().textContent())?.trim() ?? '';
    expect(target.length).toBeGreaterThan(0);

    await modal.locator('.mu').first().click();

    // The sheet is now the card that was tapped...
    await expect(modal.locator('.goldtext').first()).toHaveText(target, { timeout: 10_000 });
    // ...and the second overlay was never used, so one ✕ still closes everything.
    await expect(page.locator('#ovl2')).not.toHaveClass(/on/);
    await modal.locator('.xbtn').click();
    await expect(page.locator('#ovl')).not.toHaveClass(/on/);
  });
});

test.describe('leaderboard', () => {
  test.setTimeout(120_000);

  test('Home shows a ranking, and the modal opens the full board', async ({ page }) => {
    await enterApp(page);

    const block = page.locator('#lbBlock');
    await expect(block).toBeVisible({ timeout: 25_000 });
    // A brand-new account is the only player on an in-memory server, so it is rank 1 and the
    // row is its own — which is exactly the case the `.me` highlight exists for.
    await expect(block.locator('.lbrow').first()).toBeVisible({ timeout: 20_000 });
    await expect(block.locator('.lbrow.me')).toHaveCount(1);

    await page.locator('#lbMore').click();
    const list = page.locator('#lbList');
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.locator('.lbrow').first()).toBeVisible({ timeout: 20_000 });
    await expect(list.locator('.lbtro').first()).toContainText('🏆');
  });

  test('the trophy count in the header is the second way in', async ({ page }) => {
    await enterApp(page);
    await expect(page.locator('#lbBlock .lbrow').first()).toBeVisible({ timeout: 25_000 });

    await page.locator('.ptro').first().click();
    await expect(page.locator('#lbList .lbrow').first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('music', () => {
  test.setTimeout(120_000);

  test('can be turned off, and the choice survives a reload', async ({ page }) => {
    await enterApp(page);
    await page.locator('#avatarBox').click();

    const btn = page.locator('#stMusic');
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await expect(btn).toHaveText(/MUSIC: ON/);

    await btn.click();
    await expect(btn).toHaveText(/MUSIC: OFF/, { timeout: 15_000 });

    // It is a save field, not device storage, so it has to come back off from the server.
    await page.reload();
    const play = page.locator('#lpPlay');
    if (await play.isVisible().catch(() => false)) await play.click();
    await expect(page.locator('#hGold')).toBeVisible({ timeout: 25_000 });
    await page.locator('#avatarBox').click();
    await expect(page.locator('#stMusic')).toHaveText(/MUSIC: OFF/, { timeout: 20_000 });
  });
});

test.describe('account recovery', () => {
  test.setTimeout(180_000);

  test('a code brings the account back in a browser that has never seen it', async ({ browser }) => {
    // Two independent contexts is the whole point: separate storage means a separate device
    // id, which is exactly the situation a player is in on a new phone.
    const original = await browser.newContext();
    const originalPage = await original.newPage();
    await enterApp(originalPage);

    // Make the account distinguishable so "did the save follow the code" has a visible answer.
    await originalPage.locator('#avatarBox').click();
    await originalPage.locator('#stName').fill('RecoveredHero');
    await originalPage.locator('#stSave').click();
    await expect(originalPage.locator('#modal')).toBeHidden({ timeout: 15_000 });

    await originalPage.locator('#avatarBox').click();
    await originalPage.locator('#stRecover').click();
    await originalPage.locator('#rcMake').click();
    const code = (await originalPage.locator('#rcCode').textContent({ timeout: 20_000 }))?.trim() ?? '';
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
    await original.close();

    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await enterApp(freshPage);
    // A brand-new account, as it would be after clearing storage.
    await expect(freshPage.locator('#hName')).not.toHaveText('RecoveredHero');

    await freshPage.reload();
    await freshPage.locator('#lpRecover').click();
    await freshPage.locator('#rcIn').fill(code);
    await freshPage.locator('#rcGo').click();

    // The page reloads itself on success, and boots signed in as the recovered account.
    await expect(freshPage.locator('#hName')).toHaveText('RecoveredHero', { timeout: 40_000 });
    await fresh.close();
  });

  test('a wrong code is refused without saying why', async ({ page }) => {
    await enterApp(page);
    await page.reload();
    await page.locator('#lpRecover').click();
    await page.locator('#rcIn').fill('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ');
    await page.locator('#rcGo').click();
    await expect(page.locator('#rcErr')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#rcErr')).toContainText('does not match');
  });
});
