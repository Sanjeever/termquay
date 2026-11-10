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

test('forwarding route follows local, remote and dynamic form values without starting a tunnel', async ({
  page,
}) => {
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/e2e/workflow.html');
  await page.getByRole('button', { name: 'Port forwarding', exact: true }).click();
  const route = page.getByRole('list', { name: 'Forwarding route' });
  await expect(route).toContainText('This computer');
  await page.getByRole('spinbutton', { name: 'Listen port', exact: true }).fill('13306');
  await page
    .getByRole('spinbutton', { name: 'Forward destination port', exact: true })
    .fill('3306');
  await expect(route).toContainText('127.0.0.1:13306');
  await expect(route).toContainText('127.0.0.1:3306');
  await expect(route).toContainText('Destination reached by SSH host');
  await page.getByRole('button', { name: 'Forwarding type' }).click();
  await page.getByRole('option', { name: 'Remote', exact: true }).click();
  await expect(route.locator('li').first()).toContainText('SSH host');
  await expect(route).toContainText('Destination reached by this computer');
  await page.getByRole('button', { name: 'Forwarding type' }).click();
  await page.getByRole('option', { name: 'Dynamic SOCKS5', exact: true }).click();
  await expect(route).toContainText('Requested by SOCKS5 client');
  await expect(page.getByRole('spinbutton', { name: 'Forward destination port' })).toHaveCount(0);
  await page.setViewportSize({ width: 620, height: 650 });
  await page.getByRole('button', { name: 'Chinese', exact: true }).click();
  await expect(page.getByRole('list', { name: '转发路径' })).toContainText('由 SOCKS5 客户端指定');
  expect(
    await page
      .locator('.tunnel-panel')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
