import { expect, test, type Page } from '@playwright/test';

async function openWorkspace(page: Page) {
  let created = 1;
  const closed: string[] = [];
  const inputs = new Map<string, string[]>();
  const launches: unknown[][] = [];
  const output = new Map<string, (text: string) => void>();
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
        output.set(id, (text) => socket.send(Buffer.from(text)));
        socket.send(Buffer.from(`\x1b[?25l\x1b[?2004h${id} ready\r\n`));
      } else if (frame[0] === 0) inputs.get(id)!.push(frame.subarray(1).toString('utf8'));
    });
  });
  await page.goto('/e2e/local-workspace.html');
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
  return { closed, inputs, launches, send: (id: string, text: string) => output.get(id)!(text) };
}

async function layout(page: Page, name: string) {
  await page.getByRole('button', { name: /Terminal layout/ }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('six layouts retain live terminals through resizing, moving, maximizing and language changes', async ({
  page,
}) => {
  const { closed, inputs, launches } = await openWorkspace(page);
  const first = await page.locator('[data-terminal-id="local-1"] .xterm').elementHandle();
  const canvas = await page.locator('[data-terminal-id="local-1"] canvas').first().elementHandle();
  for (let index = 0; index < 3; index++)
    await page.getByRole('button', { name: 'New terminal in workspace', exact: true }).click();
  await page.locator('.local-terminal-tab-select').first().click();
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
    page.getByRole('group', { name: 'Workspace terminals' }).locator('.local-terminal-tab'),
  ).toHaveCount(4);
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
  await layout(page, 'Split right');
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

test('a failed split keeps the existing layout and exposes the operation error', async ({
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
  await layout(page, 'Split right');
  await expect(page.getByRole('alert')).toContainText('local PTY limit reached');
  await expect(page.locator('.local-terminal-pane:visible')).toHaveCount(1);
  await expect(page.locator('.local-terminal-empty')).toHaveCount(0);
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

test('explicit terminal bells request attention once and focus acknowledges the correct pane', async ({
  page,
}) => {
  const { send } = await openWorkspace(page);
  const notifications: string[] = [];
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.args?.methodID === 1304035475) notifications.push(body.args.args[0]);
    await route.fallback();
  });
  await layout(page, 'Split right');
  await page.locator('[data-terminal-id="local-1"] .local-terminal-pane-title').click();
  await page.getByRole('button', { name: 'Terminal actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Enable terminal notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  send('local-1', '\x07\x07');
  await expect.poll(() => notifications).toEqual(['local-1']);
  send('local-1', '\x07');
  await page.waitForTimeout(50);
  expect(notifications).toEqual(['local-1']);
  await page.evaluate(() =>
    Reflect.get(window, '_wails').dispatchWailsEvent({ name: 'common:WindowFocus', data: null }),
  );
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  await expect(page.locator('.terminal-attention.attention')).toHaveCount(0);
  send('local-1', '\x1b]2;Codex 中文\x07');
  await expect(page.locator('[data-terminal-id="local-1"] .local-terminal-pane-title')).toHaveText(
    'Codex 中文',
  );
  send('local-2', '\x07');
  await expect(
    page.locator('[data-terminal-id="local-2"] .terminal-attention.attention'),
  ).toHaveCount(1);
  expect(notifications).toEqual(['local-1']);
  await page.locator('[data-terminal-id="local-2"] .local-terminal-pane-title').click();
  await expect(page.locator('.terminal-attention.attention')).toHaveCount(0);
});

test('program status survives focus, hiding and alternate screens and answers probes in order', async ({
  page,
}) => {
  const { inputs, send } = await openWorkspace(page);
  const pane = page.locator('[data-terminal-id="local-1"]');
  send('local-1', '\x1b]7501;?\x07\x1b[c');
  await expect.poll(() => inputs.get('local-1')!.length).toBe(2);
  expect(inputs.get('local-1')![0]).toBe(
    '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\',
  );
  expect(inputs.get('local-1')![1].startsWith('\x1b[?')).toBe(true);
  await layout(page, 'Split right');
  send('local-1', '\x1b[?1049h\x1b]7501;state=working:app=codex\x07');
  await expect(pane.locator('.terminal-program-state')).toHaveText('Running');
  send('local-1', '\x1b]7501;state=blocked:kind=permission:app=codex:msg=QXBwcm92ZSBjb21tYW5k\x07');
  await expect(pane.locator('.terminal-program-state')).toHaveText('Awaiting approval');
  await pane.locator('.local-terminal-pane-title').click();
  await expect(pane.locator('.terminal-program-state')).toHaveText('Awaiting approval');
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  await expect(pane.locator('.terminal-program-state')).toHaveText('Awaiting approval');
  await page.getByRole('button', { name: 'Toggle language', exact: true }).click();
  await expect(pane.locator('.terminal-program-state')).toHaveText('等待授权');
  send('local-1', '\x1b]7501;state=idle:app=codex\x07');
  await expect(pane.locator('.terminal-program-state')).toHaveText('就绪');
  send('local-1', '\x1b[?1049l\x1b]133;A\x07');
  await expect(pane.locator('.terminal-program-state')).toHaveCount(0);
  send('local-1', '\x1b]7501;state=done:app=codex\x07');
  await expect(pane.locator('.terminal-program-state')).toHaveCount(1);
  await page.locator('[data-terminal-id="local-2"] .local-terminal-pane-title').click();
  await pane.locator('.local-terminal-pane-title').click();
  await expect(pane.locator('.terminal-program-state')).toHaveCount(0);
});

test('background program notifications report transitions once without inferring completion from idle', async ({
  page,
}) => {
  const { send } = await openWorkspace(page);
  const notifications: string[] = [];
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.args?.methodID === 1304035475) notifications.push(body.args.args[0]);
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Terminal actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Enable terminal notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  send(
    'local-1',
    '\x1b]7501;state=blocked:kind=question\x07\x1b]7501;state=blocked:kind=question\x07\x07',
  );
  await expect.poll(() => notifications).toEqual(['local-1']);
  send('local-1', '\x1b]7501;state=idle\x07');
  await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
  await expect(page.locator('.local-terminal-tabs .terminal-program-state')).toHaveText('Ready');
  expect(notifications).toEqual(['local-1']);
});

test('new sessions remain discoverable and single panes use one toolbar', async ({ page }) => {
  const { inputs, closed, send } = await openWorkspace(page);
  const tabs = page.getByRole('group', { name: 'Workspace terminals' });
  await expect(page.locator('.local-terminal-pane-header')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lock input', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New terminal in workspace', exact: true }).click();
  await expect(tabs.locator('.local-terminal-tab')).toHaveCount(2);
  await expect(page.locator('[data-terminal-id="local-1"]')).toBeHidden();
  send('local-1', '\x1b]7501;state=blocked:kind=permission:app=codex\x07');
  await expect(tabs.locator('.terminal-program-state')).toHaveText('Awaiting approval');
  await tabs.locator('.local-terminal-tab-select').first().click();
  await expect(page.locator('[data-terminal-id="local-1"] .xterm-helper-textarea')).toBeFocused();
  await page.keyboard.type('still here');
  await expect.poll(() => inputs.get('local-1')!.join('')).toBe('still here');
  await tabs.locator('.local-terminal-tab-select').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-terminal-id="local-2"] .xterm-helper-textarea')).toBeFocused();
  expect(closed).toEqual([]);
});

test('layout presets never start processes and directional splits retain input targets', async ({
  page,
}) => {
  const { launches, closed, inputs } = await openWorkspace(page);
  await layout(page, 'Four panes');
  await expect(page.locator('.local-terminal-empty')).toHaveCount(3);
  expect(launches).toEqual([]);
  await layout(page, 'Single');
  await layout(page, 'Split right');
  await expect(page.locator('[data-terminal-id="local-2"] .xterm-helper-textarea')).toBeFocused();
  await page.keyboard.type('right');
  await layout(page, 'Split down');
  await expect(page.locator('[data-terminal-id="local-3"]')).toHaveCSS('grid-column-start', '3');
  await expect(page.locator('[data-terminal-id="local-3"]')).toHaveCSS('grid-row-start', '3');
  await page.keyboard.type('below');
  await expect.poll(() => inputs.get('local-2')!.join('')).toBe('right');
  await expect.poll(() => inputs.get('local-3')!.join('')).toBe('below');
  expect(launches).toHaveLength(2);
  expect(closed).toEqual([]);
});
