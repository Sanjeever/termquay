import { expect, test } from '@playwright/test';

test('narrow monitoring and workspace controls remain readable in both languages', async ({
  page,
}) => {
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.setViewportSize({ width: 620, height: 650 });
  await page.goto('/e2e/workflow.html');
  for (const language of ['English', 'Chinese']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    const panel = page.locator('.monitor-panel');
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const heading = panel.locator('.sidebar-heading');
    const title = await heading.locator('h2').boundingBox();
    const action = await heading.locator('.session-tool').boundingBox();
    expect(action!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
    await expect(heading.locator('.icon-button')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
