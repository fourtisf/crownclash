/**
 * The two things added to make the game easier to pick up:
 * a first-match walkthrough, and a way out of a match you are losing.
 *
 * Both are tested through the real UI because both are about *feel* — whether the coach marks
 * actually appear where a player is looking, and whether giving up really ends the match in a
 * couple of seconds instead of three minutes.
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

test.describe('first-match tutorial', () => {
  test.setTimeout(180_000);

  test('coach marks guide a brand-new player through their first deploy', async ({ page }) => {
    await enterApp(page);
    await page.locator('#btnBattle').click();
    await expect(page.locator('#battle.on')).toBeVisible({ timeout: 30_000 });

    const coach = page.locator('#coach');
    await expect(coach).toHaveClass(/on/, { timeout: 20_000 });
    await expect(page.locator('#coachStep')).toContainText('STEP 1 OF');
    await expect(page.locator('#coachText')).toContainText('elixir');
    // Step 1 rings the elixir bar.
    await expect(page.locator('#elixBar')).toHaveClass(/coach-target/);

    // Step 2 asks for a card tap and rings the hand.
    await expect(page.locator('#coachText')).toContainText('Tap a', { timeout: 20_000 });
    await expect(page.locator('#handRow')).toHaveClass(/coach-target/);

    // Tapping a card must advance it — the step is waiting on exactly that.
    await page.locator('#handRow .hcard[data-i="0"]').click();
    await expect(page.locator('#coachText')).toContainText('your half', { timeout: 20_000 });
    await expect(page.locator('#arenaWrap')).toHaveClass(/coach-target/);

    // ...and deploying advances again.
    const box = await page.locator('#arena').boundingBox();
    await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.85);
    await expect(page.locator('#coachText')).toContainText('crown', { timeout: 20_000 });

    // It finishes on its own and gets out of the way.
    await expect(coach).not.toHaveClass(/on/, { timeout: 40_000 });
  });

  test('the walkthrough does not come back on the second match', async ({ page }) => {
    await enterApp(page);
    await page.locator('#btnBattle').click();
    await expect(page.locator('#battle.on')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#coach')).toHaveClass(/on/, { timeout: 20_000 });
    await page.locator('#coachSkip').click();
    await expect(page.locator('#coach')).not.toHaveClass(/on/);

    // Quit out, start again — the server has recorded that it was seen.
    await page.locator('#giveUp').click();
    await page.locator('#guYes').click();
    await expect(page.locator('.resbanner')).toBeVisible({ timeout: 30_000 });
    await page.locator('#resAgain').click();
    await expect(page.locator('#battle.on')).toBeVisible({ timeout: 30_000 });

    // Give it a real chance to appear before asserting it does not.
    await page.waitForTimeout(3000);
    await expect(page.locator('#coach')).not.toHaveClass(/on/);
  });
});

test.describe('give up', () => {
  test.setTimeout(180_000);

  test('ends the match in seconds and costs trophies, instead of a 3-minute wait', async ({ page }) => {
    await enterApp(page);
    await page.locator('#btnBattle').click();
    await expect(page.locator('#battle.on')).toBeVisible({ timeout: 30_000 });
    const skip = page.locator('#coachSkip');
    if (await skip.isVisible().catch(() => false)) await skip.click();

    const started = Date.now();
    await page.locator('#giveUp').click();

    // Confirmation first — an accidental tap must not cost a match.
    await expect(page.locator('#guYes')).toBeVisible();
    await page.locator('#guNo').click();
    await expect(page.locator('#guYes')).toBeHidden();
    await expect(page.locator('#battle.on')).toBeVisible(); // still playing

    await page.locator('#giveUp').click();
    await page.locator('#guYes').click();

    await expect(page.locator('.resbanner')).toHaveText('DEFEAT', { timeout: 30_000 });
    // The whole point: out in well under the 180 s a full match takes.
    expect(Date.now() - started).toBeLessThan(30_000);

    await page.locator('#resHome').click();
    // A new account is at 0 trophies and the floor is 0, so the loss shows up as a played match.
    await expect(page.locator('#stLose')).toHaveText('1', { timeout: 15_000 });
  });

  test('is hidden outside a match', async ({ page }) => {
    await enterApp(page);
    await expect(page.locator('#giveUp')).toBeHidden();
  });
});
