import { expect, test, type Page } from '@playwright/test';

async function openWorkspace(page: Page) {
  let created = 1;
  const closed: string[] = [];
  const inputs = new Map<string, string[]>();
  const launches: unknown[][] = [];
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    let value: unknown = null;
    if (body?.object === 0) {
      const { methodID, args } = body.args;
      if (methodID === 2099865801) {
        launches.push(args);
        value = {
          id: `local-${++created}`,
          name: 'Shell',
          directory: '/work/project',
          hostname: 'computer',
        };
      } else if (methodID === 248113312) value = '/work/project';
      else if (methodID === 2842273149) closed.push(args[0]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  });
  await page.routeWebSocket('**/local-workspace-fixture', (socket) => {
    let id = '';
    socket.onMessage((data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!id) {
        id = frame.toString('utf8');
        inputs.set(id, []);
        socket.send(Buffer.from(`\x1b[?25l\x1b[?2004h${id} ready\r\n`));
      } else if (frame[0] === 0) inputs.get(id)!.push(frame.subarray(1).toString('utf8'));
    });
  });
  await page.goto('/e2e/local-workspace.html');
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
  return { closed, inputs, launches };
}

async function layout(page: Page, name: string) {
  await page.getByRole('button', { name: /Terminal layout/ }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('six layouts retain live terminals through resizing, moving, maximizing and language changes', async ({
  page,
}) => {
  const { closed, inputs, launches } = await openWorkspace(page);
  const first = await page.locator('[data-terminal-id="local-1"] .xterm').elementHandle();
  const canvas = await page.locator('[data-terminal-id="local-1"] canvas').first().elementHandle();
  const expected = [
    ['Two columns', 2],
    ['Two rows', 2],
    ['Three columns', 3],
    ['Three rows', 3],
    ['Four panes', 4],
  ] as const;
  for (const [name, count] of expected) {
    await layout(page, name);
    await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(count);
  }
  expect(launches).toHaveLength(3);
  expect(launches.every((args) => args[0] === 'shell' && args[1] === '/work/project')).toBe(true);
  await page.getByRole('button', { name: 'Focus right', exact: true }).click();
  await expect(page.getByLabel('Active terminal')).toHaveText('local-2');
  await page.keyboard.type('right');
  await expect.poll(() => inputs.get('local-2')?.join('')).toBe('right');
  await page.getByRole('button', { name: 'Focus down', exact: true }).click();
  await expect(page.getByLabel('Active terminal')).toHaveText('local-4');
  const divider = page.getByRole('separator', { name: 'Column divider 1' });
  await divider.focus();
  await expect(divider).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '60');
  await divider.dblclick({ position: { x: 2, y: 20 } });
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  const title = page.locator('[data-terminal-id="local-1"] .local-terminal-pane-title');
  await title.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('[data-terminal-id="local-1"]')).toHaveCSS('grid-column-start', '3');
  await title.dragTo(page.locator('[data-terminal-id="local-4"] .local-terminal-pane-title'));
  await expect(page.locator('[data-terminal-id="local-1"]')).toHaveCSS('grid-row-start', '3');
  await page.getByRole('button', { name: 'Maximize pane', exact: true }).click();
  await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Restore panes', exact: true }).click();
  await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(4);
  await page.getByRole('button', { name: 'Toggle language', exact: true }).click();
  await expect(page.getByRole('button', { name: /终端布局/ })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle language', exact: true }).click();
  await layout(page, 'Single');
  await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Workspace terminals', exact: true }),
  ).toContainText('4 terminals');
  await layout(page, 'Four panes');
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  expect(
    await first!.evaluate(
      (node) => node === document.querySelector('[data-terminal-id="local-1"] .xterm'),
    ),
  ).toBe(true);
  expect(
    await canvas!.evaluate(
      (node) => node === document.querySelector('[data-terminal-id="local-1"] canvas'),
    ),
  ).toBe(true);
  expect(closed).toEqual([]);
  await page.setViewportSize({ width: 760, height: 650 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(4);
});

test('closing a pane confirms once, preserves other terminals and releases the workspace', async ({
  page,
}) => {
  const { closed, inputs } = await openWorkspace(page);
  await layout(page, 'Two columns');
  await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(2);
  const close = page
    .locator('[data-terminal-id="local-1"] .local-terminal-pane-header')
    .getByRole('button', { name: 'Close terminal project', exact: true });
  await close.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(closed).toEqual([]);
  await close.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close terminal', exact: true })
    .click();
  await expect(page.locator('[data-terminal-id="local-1"]')).toHaveCount(0);
  await expect.poll(() => closed).toEqual(['local-1']);
  await page.locator('[data-terminal-id="local-2"] .xterm-helper-textarea').focus();
  await page.keyboard.type('alive');
  await expect.poll(() => inputs.get('local-2')?.join('')).toBe('alive');
  await page.getByRole('button', { name: 'Remove workspace', exact: true }).click();
  await expect.poll(() => closed.slice().sort()).toEqual(['local-1', 'local-2']);
});

test('a partial open failure keeps existing terminals and exposes the operation error', async ({
  page,
}) => {
  await openWorkspace(page);
  await page.route('**/wails/runtime*', (route) => {
    const body = route.request().postDataJSON();
    const opening = body?.args?.methodID === 2099865801;
    return route.fulfill({
      status: opening ? 500 : 200,
      contentType: 'application/json',
      body: opening ? JSON.stringify({ message: 'local PTY limit reached' }) : 'null',
    });
  });
  await layout(page, 'Four panes');
  await expect(page.getByRole('alert')).toContainText('local PTY limit reached');
  await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(1);
  await expect(page.locator('.local-terminal-empty')).toHaveCount(3);
});

test('closing during creation releases a late PTY instead of reviving the workspace', async ({
  page,
}) => {
  const { closed } = await openWorkspace(page);
  let complete: (() => Promise<void>) | undefined;
  await page.route('**/wails/runtime*', async (route) => {
    if (route.request().postDataJSON()?.args?.methodID !== 2099865801) return route.fallback();
    complete = () =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'local-late',
          name: 'Shell',
          directory: '/work/project',
          hostname: 'computer',
        }),
      });
  });
  await page.getByRole('button', { name: 'New terminal in workspace', exact: true }).click();
  await expect.poll(() => !!complete).toBe(true);
  await page.getByRole('button', { name: 'Remove workspace', exact: true }).click();
  await complete!();
  await expect.poll(() => closed.slice().sort()).toEqual(['local-1', 'local-late']);
  await expect(page.locator('.local-workspace')).toHaveCount(0);
});
