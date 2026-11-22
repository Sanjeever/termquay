import { expect, test, type Page } from '@playwright/test';

test('catalog column controls preserve the row connection action', async ({ page }) => {
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.goto('/e2e/workflow.html?scene=connections&language=en');
  const row = page.locator('.connection-row').filter({ hasText: /SSH/ }).first();
  const name = await row.locator('.connection-select').getAttribute('aria-label');
  const host = row.locator('.connection-host');
  await expect(host).toBeVisible();
  await page.getByRole('button', { name: 'Connection columns' }).click();
  const address = page.getByRole('checkbox', { name: 'Address', exact: true });
  await address.uncheck();
  await expect(host).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Address column width' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset columns' }).click();
  await expect(host).toBeVisible();
  const width = page.getByRole('slider', { name: 'Address column width' });
  await width.focus();
  await width.press('End');
  expect((await row.locator('.connection-address-text').boundingBox())?.width).toBe(360);
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: `Connect to ${name}`, exact: true }).click();
  await expect(page.locator('.xterm')).toBeVisible();
});

test('address copy is independent of connection selection and excludes the port', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.goto('/e2e/workflow.html?scene=connections&language=en');
  const row = page.locator('.connection-row').first();
  const address = (await row.locator('.connection-host').textContent())!;
  const selected = await row.getAttribute('class');
  await row.getByRole('button', { name: `Copy address ${address}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  await expect(row).toHaveAttribute('class', selected!);
  await expect(row.locator('.connection-port')).toHaveText(/^\d+$/);
  const bounds = await row.locator('.connection-port').boundingBox();
  const host = await row.locator('.connection-address-text').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(host!.x + host!.width);
});

for (const language of ['en', 'zh-CN']) {
  test(`connection states remain readable in compact and wide catalogs (${language})`, async ({
    page,
  }) => {
    await page.route('**/wails/runtime*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
    );
    await page.goto(`/e2e/workflow.html?scene=connections&language=${language}`);
    for (const width of [1440, 900, 620]) {
      await page.setViewportSize({ width, height: 900 });
      const states = page
        .locator('.connection-session-state')
        .filter({ hasText: /Connected|已连接/ });
      await expect(states).toHaveCount(2);
      for (const state of await states.all()) {
        await expect(state).toBeVisible();
        expect(await state.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
      const protocol = page.locator('.connection-protocol.catalog-column-sort');
      await protocol.click();
      for (const zoom of [1, 1.5, 2]) {
        await page.evaluate((value) => {
          document.documentElement.style.zoom = String(value);
        }, zoom);
        expect(
          await protocol.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element.firstChild!);
            return range.getClientRects().length;
          }),
        ).toBe(1);
        expect(
          await protocol.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = '';
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });

  test(`workspace tools retain editor content and remain reachable beside narrow panels (${language})`, async ({
    page,
  }) => {
    await page.route('**/wails/runtime*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `/e2e/workflow.html?scene=editor&language=${language}&theme=${language === 'en' ? 'dark' : 'light'}`,
    );
    const editor = page.locator('.cm-editor:visible');
    await expect(editor).toBeVisible();
    const instance = await editor.elementHandle();
    const content = editor.locator('.cm-content');
    await content.click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('# unsaved\n');
    const rail = page.locator('.workspace-tool-rail:visible');
    const files = rail.getByRole('button').nth(0);
    const monitor = rail.getByRole('button').nth(1);
    await files.focus();
    await page.keyboard.press('ArrowDown');
    await expect(monitor).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(monitor).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 760, height: 650 });
    await monitor.click();
    await expect(page.locator('.monitor-dock:visible')).toBeVisible();
    await expect
      .poll(async () => {
        const dock = await page.locator('.monitor-dock:visible').boundingBox();
        const tools = await rail.boundingBox();
        return dock!.x + dock!.width - tools!.x;
      })
      .toBeLessThanOrEqual(1);
    await files.click();
    await expect(page.locator('.file-dock:visible')).toBeVisible();
    await files.click();
    expect(await editor.evaluate((element, original) => element === original, instance)).toBe(true);
    await expect(content).toContainText('# unsaved');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('file selection actions collapse without leaving a gap above the directory tree', async ({
  page,
}) => {
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.goto('/e2e/workflow.html');
  await page.getByRole('button', { name: 'File tree', exact: true }).click();
  const panel = page.locator('.file-panel');
  const actions = panel.locator('.file-selection');
  const tree = panel.getByRole('tree');
  const file = tree.getByRole('treeitem', { name: 'nginx.conf', exact: true });
  await expect(file).toBeVisible();
  for (const [language, colorScheme] of [
    ['English', 'light'],
    ['Chinese', 'dark'],
  ] as const) {
    await page.getByRole('button', { name: language, exact: true }).click();
    await page.emulateMedia({ colorScheme });
    for (const width of [220, 300, 420]) {
      await page.locator('.file-dock').evaluate((element, width) => {
        element.style.width = `${width}px`;
      }, width);
      await expect(actions).toBeHidden();
      const path = await panel.locator('.path-bar').boundingBox();
      expect((await tree.boundingBox())!.y - path!.y - path!.height).toBeLessThanOrEqual(8);
      await file.focus();
      await page.keyboard.press('Space');
      await expect(actions).toBeVisible();
      await expect(file).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Space');
      await expect(actions).toBeHidden();
      await expect(file).toHaveAttribute('aria-selected', 'false');
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
  }
  await file.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(actions.getByRole('checkbox')).toBeChecked();
  await actions.getByRole('checkbox').uncheck();
  await expect(actions).toBeHidden();
});

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
    const overview = panel.locator('.monitor-summary-values');
    await expect(overview).toHaveCount(3);
    await expect(overview.nth(0)).toHaveText(/↓ [\d.]+ KiB\/s↑ [\d.]+ KiB\/s/);
    await expect(overview.nth(1)).toContainText('32.0 KiB/s');
    await expect(overview.nth(2)).toContainText('24.0 GiB / 80.0 GiB');
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

async function fileWorkspace(page: Page) {
  const calls: { method: number; args: unknown[] }[] = [];
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    const method = body?.args?.methodID;
    const args = body?.args?.args || [];
    let value: unknown = null;
    if (body?.object === 0) calls.push({ method, args });
    if (method === 2404688278) {
      const directory = args[1] || (args[0] ? '/remote' : '/local');
      value = {
        path: directory,
        parent: '/',
        truncated: false,
        entries: [
          {
            name: 'config',
            path: directory + '/config',
            directory: true,
            symlink: false,
            mode: 'drwxr-xr-x',
            size: 0,
            modified: 1700000000000,
          },
          {
            name: 'release.conf',
            path: directory + '/release.conf',
            directory: false,
            symlink: false,
            mode: '-rw-r--r--',
            size: 2048,
            modified: 1700000000000,
          },
        ],
      };
    } else if (method === 1375116584)
      value = {
        id: 'preview-1',
        direction: 'upload',
        local: args[1],
        remote: args[3],
        entries: [{ path: 'release.conf', state: 'new', directory: false, size: 2048 }],
      };
    else if (method === 1166658499)
      value = {
        id: 'transfer-1',
        workspace: 'host-a',
        name: 'release.conf',
        state: 'running',
        direction: 'upload',
        total: 2048,
        completed: 0,
      };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  });
  await page.goto('/e2e/workflow.html');
  await page.getByRole('button', { name: 'Files workspace', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Left location' })
      .getByRole('checkbox', { name: 'Select release.conf' }),
  ).toBeVisible();
  return calls;
}

async function sshWorkflow(page: Page, language = 'en', autoForward = false, compactSSH = false) {
  const calls: { method: number; args: unknown[] }[] = [];
  const forwards: unknown[] = [];
  const inputs: string[] = [];
  const sockets: { send(data: Buffer): void; id: string; terminal: boolean }[] = [];
  await page.routeWebSocket('**/ssh-fixture/*', (socket) => {
    const entry = {
      send: (data: Buffer) => socket.send(data),
      id: '',
      terminal: socket.url().endsWith('/terminal'),
    };
    sockets.push(entry);
    socket.onMessage((data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (frame[0] === 0) inputs.push(frame.subarray(1).toString('utf8'));
      else if (frame[0] !== 1) entry.id = frame.toString('utf8');
    });
    socket.send(Buffer.from('\x1b[?2004h'));
  });
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    const method = body?.args?.methodID;
    const args = body?.args?.args || [];
    let value: unknown = null;
    if (body?.object === 0) calls.push({ method, args });
    if (method === 504709045 || method === 2404688278) {
      const path = args[1] || (method === 504709045 ? '/' : args[0] ? '/remote' : '/local');
      const prefix = path === '/' ? '' : path;
      value = {
        path,
        parent: path.slice(0, path.lastIndexOf('/')) || '/',
        truncated: false,
        entries: [
          ...['config', 'subdir'].map((name) => ({
            name,
            path: `${prefix}/${name}`,
            directory: true,
            symlink: false,
            mode: 'drwxr-xr-x',
            size: 0,
            modified: 1700000000000,
          })),
          {
            name: 'release.conf',
            path: `${prefix}/release.conf`,
            directory: false,
            symlink: false,
            mode: '-rw-r--r--',
            size: 2048,
            modified: 1700000000000,
          },
        ],
      };
    } else if (method === 482496204)
      value = {
        path: args[1],
        content: 'original file\n',
        revision: 'v1',
        encoding: 'UTF-8',
        line_ending: 'LF',
        bom: false,
      };
    else if (method === 3975293328)
      value = autoForward
        ? [
            {
              name: 'Database',
              auto_start: true,
              spec: {
                kind: 'local',
                bind_host: '127.0.0.1',
                bind_port: 13306,
                target_host: '127.0.0.1',
                target_port: 3306,
                allow_public: false,
              },
            },
          ]
        : [];
    else if (method === 4013407056) {
      value = {
        id: 'forward-1',
        workspace: args[0],
        spec: args[1],
        info: {
          state: 'running',
          address: '127.0.0.1:13306',
          active: 0,
          error: '',
        },
      };
      forwards.push(value);
    } else if (method === 495421101) value = forwards;
    else if (method === 272076810) value = { id: 'host-a-terminal-2' };
    else if (method === 1375116584)
      value = {
        id: 'preview-ssh',
        direction: 'download',
        local: args[3],
        remote: args[1],
        entries: [],
      };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/e2e/workflow.html?scene=ssh&language=${language}&theme=${autoForward && language === 'zh-CN' ? 'dark' : 'light'}&compactSSH=${compactSSH}`,
  );
  await expect(page.locator('.file-panel [data-tree-path="/config"]')).toBeVisible();
  await expect.poll(() => sockets.length).toBe(2);
  return {
    calls,
    inputs,
    send(data: string) {
      for (const socket of sockets) {
        if (socket.terminal) socket.send(Buffer.from(data));
      }
    },
    directory(path: string, host = 'app.example.invalid', terminal?: string) {
      for (const socket of sockets) {
        if (socket.terminal && (!terminal || socket.id === terminal))
          socket.send(Buffer.from(`\x1b]7;file://${host}${path}\x07`));
      }
    },
  };
}

test('SSH file opening stacks the editor above the live terminal and layout changes preserve both', async ({
  page,
}) => {
  await sshWorkflow(page);
  await page.locator('[data-tree-path="/release.conf"] .file-name').dblclick();
  const editor = page.locator('.cm-editor:visible');
  await expect(editor).toBeVisible();
  const instance = await editor.elementHandle();
  const terminal = page.locator('.terminal-tab:visible .xterm');
  const terminalInstance = await terminal.elementHandle();
  const editorBounds = await editor.boundingBox();
  const terminalBounds = await terminal.boundingBox();
  expect(terminalBounds!.y).toBeGreaterThan(editorBounds!.y + editorBounds!.height);
  await editor.locator('.cm-content').click();
  await page.keyboard.type('unsaved ');
  await page.getByRole('button', { name: 'Pane layout', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Side by side panes', exact: true }).click();
  expect(await editor.evaluate((element, original) => element === original, instance)).toBe(true);
  expect(
    await terminal.evaluate((element, original) => element === original, terminalInstance),
  ).toBe(true);
  await expect(editor.locator('.cm-content')).toContainText('unsaved');
  await page.getByRole('button', { name: 'Pane layout', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Top and bottom panes', exact: true }).click();
  await expect(page.getByRole('separator', { name: 'Split pane ratio' })).toHaveAttribute(
    'aria-orientation',
    'horizontal',
  );
  await page.screenshot({ path: test.info().outputPath('ssh-stacked-workspace.png') });
});

test('the compact SSH workspace shows its docks and splits from the focused pane', async ({
  page,
}) => {
  await sshWorkflow(page, 'en', false, true);
  const terminal = page.locator('.terminal-tab:visible .xterm');
  await expect(terminal).toBeVisible();
  const original = await terminal.elementHandle();
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const files = await page.locator('.file-dock').boundingBox();
    const monitor = await page.locator('.monitor-dock').boundingBox();
    const content = await terminal.boundingBox();
    expect(files!.x + files!.width).toBeLessThan(content!.x);
    expect(content!.x + content!.width).toBeLessThan(monitor!.x);
  }
  await page.screenshot({ path: test.info().outputPath('compact-ssh-workspace.png') });
  await page.getByRole('button', { name: 'Split right', exact: true }).click();
  await expect(terminal).toHaveCount(2);
  await expect(page.getByRole('separator', { name: 'Split pane ratio' })).toHaveAttribute(
    'aria-orientation',
    'vertical',
  );
  expect(await terminal.first().evaluate((element, handle) => element === handle, original)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('.monitor-dock')).toBeHidden();
  const monitoring = page.getByRole('button', { name: 'Monitoring', exact: true });
  await monitoring.click();
  await expect(page.locator('.monitor-dock')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.monitor-dock')).toBeHidden();
  await expect(monitoring).toBeFocused();
});

test('file refresh keeps the selected directory and reads its branch without reading root', async ({
  page,
}) => {
  const ssh = await sshWorkflow(page);
  const directory = page.locator('[data-tree-path="/config"]');
  await directory.locator('.file-name').click();
  await expect(page.locator('.breadcrumbs')).toHaveAttribute('aria-label', '/config');
  await expect(directory).toHaveAttribute('aria-selected', 'true');
  const rootReads = ssh.calls.filter(
    (call) => call.method === 504709045 && (!call.args[1] || call.args[1] === '/'),
  ).length;
  const targetReads = () =>
    ssh.calls.filter((call) => call.method === 504709045 && call.args[1] === '/config').length;
  await expect.poll(targetReads).toBe(1);
  await directory.focus();
  await page.keyboard.press('F5');
  await expect.poll(targetReads).toBe(2);
  await expect(directory).toHaveAttribute('aria-selected', 'true');
  await directory.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Refresh directory', exact: true }).click();
  await expect.poll(targetReads).toBe(3);
  expect(
    ssh.calls.filter((call) => call.method === 504709045 && (!call.args[1] || call.args[1] === '/'))
      .length,
  ).toBe(rootReads);
});

test('directory following is explicit, pauses when disabled and rejects another host', async ({
  page,
}) => {
  const ssh = await sshWorkflow(page);
  const follow = page.getByRole('button', { name: 'Follow terminal directory', exact: true });
  const cwd = page.locator('.terminal-view .session-status .file-path');
  const breadcrumbs = page.locator('.breadcrumbs');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  ssh.directory('/config');
  await expect(cwd).toHaveText('/config');
  await expect(breadcrumbs).toHaveAttribute('aria-label', '/');
  await follow.click();
  await expect(breadcrumbs).toHaveAttribute('aria-label', '/config');
  await follow.click();
  ssh.directory('/config/subdir');
  await expect(cwd).toHaveText('/config/subdir');
  await expect(breadcrumbs).toHaveAttribute('aria-label', '/config');
  await follow.click();
  await expect(breadcrumbs).toHaveAttribute('aria-label', '/config/subdir');
  ssh.directory('/other-host', 'other.example.invalid');
  await expect(cwd).toHaveText('/other-host');
  await expect(breadcrumbs).toHaveAttribute('aria-label', '/config/subdir');
  expect(
    ssh.calls
      .filter((call) => call.method === 504709045)
      .some((call) => call.args[1] === '/other-host'),
  ).toBe(false);
});

test('directory setup uses one preview, waits for Enter and follows only confirmed reports', async ({
  page,
}) => {
  const ssh = await sshWorkflow(page);
  await page.getByRole('button', { name: 'Follow terminal directory', exact: true }).click();
  const status = page.locator('.file-follow-status');
  await expect(status).toContainText('Waiting for terminal directory');
  await status.getByRole('button', { name: 'Enable directory reporting', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enable directory reporting', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.locator('details')).not.toHaveAttribute('open');
  await dialog.locator('summary').click();
  const script = await dialog.locator('pre').innerText();
  expect(script).not.toContain('bind -x');
  expect(script).not.toContain('__termquay_record');
  expect(script).not.toContain('133;');
  expect(script).not.toMatch(/[\r\n]$/);
  await dialog.getByRole('button', { name: 'Insert into terminal', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(status).toContainText('Waiting for execution');
  await expect
    .poll(() => ssh.inputs.join(''))
    .toBe(`\x1b[200~${script.replace(/\n/g, '\r')}\x1b[201~`);
  const input = page.locator('.xterm-helper-textarea');
  await expect(input).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Waiting for terminal directory');
  ssh.directory('/config/subdir');
  await expect(status).toHaveCount(0);
  await expect(page.locator('.breadcrumbs')).toHaveAttribute('aria-label', '/config/subdir');
});

test('directory setup errors require the current token and allow retry after execution or cancellation', async ({
  page,
}) => {
  const ssh = await sshWorkflow(page);
  await page.getByRole('button', { name: 'Follow terminal directory', exact: true }).click();
  const enable = page.getByRole('button', { name: 'Enable directory reporting', exact: true });
  await enable.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Bash Shell', exact: true }).click();
  await page.getByRole('option', { name: 'Zsh', exact: true }).click();
  const script = (await dialog.locator('pre').textContent()) || '';
  const token = /termquay;([a-f0-9]{64});E/.exec(script)![1];
  await dialog.getByRole('button', { name: 'Insert into terminal', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  await expect(page.locator('.file-follow-status')).toContainText('Waiting for execution');
  ssh.send(
    `\x1b]777;termquay;${'0'.repeat(64)};E;Shell type mismatch;terminal:completionShellMismatch\x07`,
  );
  await expect(page.locator('.file-follow-status')).toContainText('Waiting for execution');
  await page.keyboard.press('Enter');
  ssh.send(`\x1b]777;termquay;${token};E;Shell type mismatch;terminal:completionShellMismatch\x07`);
  await expect(page.locator('.terminal-view')).toContainText('Current shell does not match');
  await expect(enable).toBeVisible();
  await enable.click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Insert into terminal', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  await page.keyboard.press('Control+c');
  await expect.poll(() => ssh.inputs.join('').endsWith('\x03')).toBe(true);
  await expect(enable).toBeVisible();
});

test('selected remote files open in transfers without replacing the other location', async ({
  page,
}) => {
  const ssh = await sshWorkflow(page);
  const follow = page.getByRole('button', { name: 'Follow terminal directory', exact: true });
  ssh.directory('/config');
  await expect(page.locator('.terminal-view .session-status .file-path')).toHaveText('/config');
  await follow.click();
  const file = page.locator('[data-tree-path="/config/release.conf"]');
  await expect(file).toBeVisible();
  await file.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in file transfers', exact: true }).click();
  const right = page.getByRole('region', { name: 'Right location' });
  const left = page.getByRole('region', { name: 'Left location' });
  await expect(right.getByRole('textbox', { name: 'Directory path' })).toHaveValue('/config');
  await expect(right.getByRole('checkbox', { name: 'Select release.conf' })).toBeChecked();
  await left.getByRole('textbox', { name: 'Directory path' }).fill('/local/destination');
  await left.getByRole('button', { name: 'Open / Refresh' }).click();
  await page.getByRole('button', { name: 'Back to SSH', exact: true }).click();
  await expect(page.locator('.file-panel')).toBeVisible();
  ssh.directory('/config/subdir');
  await expect(page.locator('.breadcrumbs')).toHaveAttribute('aria-label', '/config/subdir');
  await page
    .locator('.workspace-tool-rail')
    .getByRole('button', { name: 'File transfers', exact: true })
    .click();
  await expect(right.getByRole('textbox', { name: 'Directory path' })).toHaveValue(
    '/config/subdir',
  );
  await expect(left.getByRole('textbox', { name: 'Directory path' })).toHaveValue(
    '/local/destination',
  );
  await right.getByRole('checkbox', { name: 'Select release.conf' }).check();
  await page.getByRole('button', { name: /Preview right → left/i }).click();
  await expect.poll(() => ssh.calls.filter((call) => call.method === 1375116584).length).toBe(1);
  expect(ssh.calls.find((call) => call.method === 1375116584)?.args.slice(0, 5)).toEqual([
    'host-a',
    '/config/subdir',
    '',
    '/local/destination',
    ['release.conf'],
  ]);
});

test('directory readiness belongs to the active terminal and SSH instance', async ({ page }) => {
  const ssh = await sshWorkflow(page);
  const follow = page.getByRole('button', { name: 'Follow terminal directory', exact: true });
  await follow.click();
  ssh.directory('/config', 'app.example.invalid', 'host-a');
  await expect(page.locator('.file-follow-status')).toHaveCount(0);
  await page.getByRole('button', { name: 'New terminal in Main pane', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Terminal 2', exact: true })).toBeVisible();
  await expect(page.locator('.file-follow-status')).toContainText('Waiting for terminal directory');
  ssh.directory('/config/subdir', 'app.example.invalid', 'host-a');
  await expect(page.locator('.file-follow-status')).toContainText('Waiting for terminal directory');
  await expect(page.locator('.breadcrumbs')).toHaveAttribute('aria-label', '/config');
  await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
  await expect(page.locator('.file-follow-status')).toHaveCount(0);
  await expect(page.locator('.breadcrumbs')).toHaveAttribute('aria-label', '/config/subdir');
  await page.getByRole('button', { name: 'Disconnect SSH', exact: true }).click();
  await expect(page.locator('.file-follow-status')).toContainText('Select a connected terminal');
  await expect(
    page.getByRole('button', { name: 'Enable directory reporting', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Reconnect SSH', exact: true }).click();
  await expect(page.locator('.file-follow-status')).toContainText('Waiting for terminal directory');
  ssh.directory('/config', 'app.example.invalid', 'host-a');
  await expect(page.locator('.file-follow-status')).toContainText('Waiting for terminal directory');
  ssh.directory('/config', 'app.example.invalid', 'host-a-next');
  await expect(page.locator('.file-follow-status')).toHaveCount(0);
});

test('directory list reuses the file panel and browsing pauses terminal following', async ({
  page,
}) => {
  const ssh = await sshWorkflow(page);
  const files = page.locator('.file-panel');
  const path = files.locator('.breadcrumbs');
  const follow = files.getByRole('button', { name: 'Follow terminal directory', exact: true });
  const mode = files.getByRole('button', { name: 'Directory list', exact: true });
  await follow.click();
  ssh.directory('/config');
  await expect(path).toHaveAttribute('aria-label', '/config');
  const reads = ssh.calls.filter((call) => call.method === 504709045).length;
  await mode.click();
  const list = files.getByRole('list', { name: 'Directory list' });
  const configFile = list.getByRole('listitem', { name: 'release.conf', exact: true });
  await expect(configFile).toContainText('2,048');
  await expect(list.locator('[data-tree-path="/release.conf"]')).toHaveCount(0);
  expect(ssh.calls.filter((call) => call.method === 504709045)).toHaveLength(reads);
  const subdirectory = list.getByRole('listitem', { name: 'subdir', exact: true });
  await subdirectory.getByRole('button', { name: 'subdir', exact: true }).click();
  await expect(path).toHaveAttribute('aria-label', '/config');
  await subdirectory.getByRole('button', { name: 'subdir', exact: true }).dblclick();
  await expect(path).toHaveAttribute('aria-label', '/config/subdir');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await list.getByRole('button', { name: 'release.conf', exact: true }).dblclick();
  await expect(page.locator('.cm-content')).toContainText('original file');
  await mode.click();
  await expect(files.getByRole('tree')).toBeVisible();
  await expect(path).toHaveAttribute('aria-label', '/config/subdir');
  await expect(page.locator('.cm-content')).toContainText('original file');
});

test('quick input keeps its draft with the originating terminal and previews multiline text', async ({
  page,
}) => {
  const ssh = await sshWorkflow(page);
  const quickInput = page.getByRole('button', { name: 'Quick input', exact: true });
  const draft = page.getByRole('textbox', { name: 'Command draft', exact: true });
  const insert = page.getByRole('button', { name: 'Insert into terminal', exact: true });
  await quickInput.click();
  await draft.fill('pwd\nwhoami');
  await page.screenshot({ path: test.info().outputPath('ssh-quick-input.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New terminal in Main pane', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Terminal 2', exact: true })).toBeVisible();
  await quickInput.click();
  await expect(draft).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
  await page.getByRole('button', { name: 'Lock input', exact: true }).click();
  await quickInput.click();
  await expect(draft).toHaveValue('pwd\nwhoami');
  await expect(insert).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /unlock/i }).click();
  await quickInput.click();
  await insert.click();
  await expect(page.getByRole('dialog')).toContainText('whoami');
  expect(ssh.inputs.join('')).not.toContain('whoami');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await quickInput.click();
  await expect(draft).toHaveValue('pwd\nwhoami');
  await draft.fill('pwd');
  await insert.click();
  await expect.poll(() => ssh.inputs.join('')).toContain('pwd');
  expect(ssh.inputs.join('')).not.toContain('\r');
  await quickInput.click();
  await expect(draft).toHaveValue('');
});

test('directory setup stays compact in Chinese at narrow widths', async ({ page }) => {
  await sshWorkflow(page, 'zh-CN');
  await page.getByRole('button', { name: '跟随终端目录', exact: true }).click();
  await expect(page.locator('.file-follow-status')).toContainText('等待终端目录');
  await page.getByRole('button', { name: '启用目录上报', exact: true }).click();
  for (const width of [760, 620]) {
    await page.setViewportSize({ width, height: 650 });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: '插入终端', exact: true })).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: test.info().outputPath('directory-reporting-zh-CN.png') });
});

test('file workspace keeps location and selection across tabs and languages, and submits the selected remote pair', async ({
  page,
}) => {
  const calls = await fileWorkspace(page);
  const left = page.getByRole('region', { name: 'Left location' });
  expect(
    await page
      .locator('.file-transfer-workspace')
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThan(600);
  await left.getByRole('button', { name: 'File location' }).click();
  await page.getByRole('option', { name: 'Host B', exact: true }).click();
  await left.getByRole('checkbox', { name: 'Select release.conf' }).check();
  const original = await page.locator('.file-transfer-workspace').elementHandle();
  await page.getByRole('button', { name: 'Terminal workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Chinese', exact: true }).click();
  await page.getByRole('button', { name: 'Files workspace', exact: true }).click();
  expect(
    await original!.evaluate(
      (element) => element === document.querySelector('.file-transfer-workspace'),
    ),
  ).toBe(true);
  await expect(
    page.getByRole('region', { name: '左侧位置' }).getByRole('checkbox').last(),
  ).toBeChecked();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: /Preview left → Right/ }).click();
  expect(calls.find((call) => call.method === 1375116584)?.args).toEqual([
    'host-b',
    '/remote',
    'host-a',
    '/remote',
    ['release.conf'],
    [],
  ]);
  await page.getByRole('button', { name: 'Select all file differences' }).click();
  await page.getByRole('button', { name: 'Copy selected' }).click();
  await expect(page.getByLabel('Accepted transfer')).toHaveText('transfer-1');
  await page.getByRole('button', { name: 'Close files', exact: true }).click();
  await expect(page.getByLabel('Accepted transfer')).toHaveText('transfer-1');
  expect(calls.filter((call) => call.method === 1166658499).map((call) => call.args)).toEqual([
    ['preview-1', ['release.conf']],
  ]);
  expect(calls.some((call) => call.method === 3293823215)).toBe(false);
});

test('disconnected file locations stay explicit and never switch to the local filesystem', async ({
  page,
}) => {
  const calls = await fileWorkspace(page);
  const right = page.getByRole('region', { name: 'Right location' });
  await expect(right.getByRole('textbox', { name: 'Directory path' })).toHaveValue('/remote');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(right.getByRole('alert')).toContainText('SSH workspace disconnected');
  await expect(right.getByRole('textbox', { name: 'Directory path' })).toHaveValue('/remote');
  await expect(page.getByRole('button', { name: /Preview left → Right/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Terminal workspace', exact: true }).click();
  const before = calls.filter(
    (call) => call.method === 2404688278 && call.args[0] === 'host-a',
  ).length;
  await page.getByRole('button', { name: 'Files workspace', exact: true }).click();
  expect(
    calls.filter((call) => call.method === 2404688278 && call.args[0] === 'host-a'),
  ).toHaveLength(before);
  expect(
    calls.some(
      (call) => call.method === 2404688278 && call.args[0] === '' && call.args[1] === '/remote',
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 760, height: 650 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const language of ['en', 'zh-CN']) {
  test(`forwarding uses the auxiliary panel and retains its draft and automatic tunnel (${language})`, async ({
    page,
  }) => {
    const { calls } = await sshWorkflow(page, language, true);
    const button = page.locator('.workspace-tool-rail-right').getByRole('button', {
      name: language === 'en' ? 'Port forwarding' : '端口转发',
      exact: true,
    });
    const dock = page.locator('.tunnel-dock');
    await expect.poll(() => calls.filter((call) => call.method === 4013407056).length).toBe(1);
    await expect(dock).toBeHidden();
    await expect(button.locator('.workspace-tool-count')).toHaveText('1');
    const terminal = await page.locator('.terminal-view').first().elementHandle();
    const before = await page.locator('.ssh-panels').boundingBox();
    await button.click();
    await expect(dock).toBeVisible();
    await expect(dock.locator('form')).toBeHidden();
    await expect(dock.locator('.tunnel-row')).toContainText('127.0.0.1:13306');
    expect((await page.locator('.ssh-panels').boundingBox())!.height).toBe(before!.height);
    await dock
      .getByRole('button', { name: language === 'en' ? 'New' : '新建', exact: true })
      .click();
    const input = dock.getByRole('textbox', {
      name: language === 'en' ? 'Listen IP' : '监听 IP',
      exact: true,
    });
    await input.fill('127.0.0.2');
    await page.screenshot({ path: test.info().outputPath(`forwarding-wide-${language}.png`) });
    await page
      .locator('.workspace-tool-rail-right')
      .getByRole('button', {
        name: language === 'en' ? 'Monitoring' : '监控',
        exact: true,
      })
      .click();
    await expect(dock).toBeHidden();
    await expect(page.locator('.monitor-dock')).toBeVisible();
    await button.click();
    await expect(page.locator('.monitor-dock')).toBeHidden();
    await expect(input).toHaveValue('127.0.0.2');
    await page.setViewportSize({ width: 620, height: 650 });
    await expect(dock).toBeVisible();
    await expect(input).toHaveValue('127.0.0.2');
    expect(await dock.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`forwarding-narrow-${language}.png`) });
    await input.press('Escape');
    await expect(dock).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await expect(input).toHaveValue('127.0.0.2');
    expect(await terminal!.evaluate((element) => element.isConnected)).toBe(true);
    expect(calls.filter((call) => call.method === 4013407056)).toHaveLength(1);
    expect(calls.filter((call) => call.method === 3780901500)).toHaveLength(0);
  });
}

test('forwarding route follows local, remote and dynamic form values without starting a tunnel', async ({
  page,
}) => {
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/e2e/workflow.html');
  await page.getByRole('button', { name: 'Port forwarding', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.locator('.tunnel-route-details summary').click();
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

test('the file tool owns its task view while transfers survive closing the tool', async ({
  page,
}) => {
  const calls: number[] = [];
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    const method = body?.args?.methodID;
    calls.push(method);
    const args = body?.args?.args || [];
    let value: unknown = null;
    if (method === 3198086081) value = { groups: [], connections: [], session_only: true };
    else if (method === 3288919527) value = { locked: false, available: false, idle_minutes: 0 };
    else if (method === 1509178199) value = { enabled: false, drafts: [] };
    else if (method === 2326168153 || method === 2007269789) value = {};
    else if (method === 841988121) value = { entries: [], active: '' };
    else if (method === 2404688278)
      value = { path: args[1] || '/local', parent: '/', entries: [], truncated: false };
    else if (method === 706236747) value = 0;
    else if (method === 57220462)
      value = [
        {
          id: 'active-transfer',
          workspace: 'background',
          name: 'archive.zip',
          direction: 'upload',
          state: 'running',
          total: 100,
          completed: 50,
          sequence: 1,
          target: 'test@example.invalid:22',
          source_path: '/local/archive.zip',
          destination_path: '/remote/archive.zip',
          resumable: false,
          cleanup_required: false,
          resume_persisted: false,
          temporary_path: '',
          error: '',
          retryable: false,
          batch_id: 'background',
          phase: '',
          speed: 10,
          remaining_seconds: 5,
          directory: false,
        },
      ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Workbench tools' }).click();
  await page.getByRole('menuitem', { name: 'File transfers', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'File transfers', exact: true, selected: true }),
  ).toBeVisible();
  const original = await page.locator('.file-transfer-workspace').elementHandle();
  await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toHaveCount(0);
  await page.locator('.file-tool-tasks-toggle').click();
  await expect(page.locator('.file-tool-workspace .transfer-panel')).toBeVisible();
  await expect(page.locator('.transfer-panel')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Connection center', exact: true }).click();
  await page
    .locator('.workbench-status')
    .getByRole('button', { name: /transfer/i })
    .click();
  await expect(page.locator('.transfer-panel')).toBeVisible();
  await page.getByRole('tab', { name: 'File transfers', exact: true }).click();
  await expect(page.locator('.file-tool-workspace .transfer-panel')).toBeVisible();
  await expect(page.locator('.transfer-panel')).toHaveCount(1);
  expect(
    await original!.evaluate(
      (element) => element === document.querySelector('.file-transfer-workspace'),
    ),
  ).toBe(true);
  await page.locator('[data-workspace-id="file-transfers"] .tab-close').click();
  await expect(page.getByRole('tab', { name: 'File transfers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toHaveCount(0);
  await page
    .locator('.workbench-status')
    .getByRole('button', { name: /transfer/i })
    .click();
  await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toBeVisible();
  await expect(page.locator('[data-transfer-id="active-transfer"]')).toContainText('archive.zip');
  expect(calls).not.toContain(3293823215);
});

test('the editor saves normally without commands and explicitly saves and validates from its toolbar', async ({
  page,
}) => {
  const actions: unknown[][] = [];
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    let value: unknown = null;
    if (body?.args?.methodID === 1754201140)
      value = {
        enabled: true,
        validate: 'check-config',
        reload: 'reload-service',
        health_check: '',
        versions: [],
      };
    if (body?.args?.methodID === 2078851123) {
      actions.push(body.args.args);
      value = {
        stdout: 'validation output',
        duration_ms: 20,
        stderr: '',
        exit_code: 0,
        truncated: false,
        error: '',
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  });
  await page.goto('/e2e/workflow.html');
  await page.getByRole('button', { name: 'Configuration editor', exact: true }).click();
  await page.locator('.cm-content').fill('first edit');
  await page.locator('.editor-save').click();
  expect(actions).toHaveLength(0);
  await page.locator('.cm-content').fill('second edit');
  await page.getByRole('button', { name: 'Save and validate', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('validation output');
  expect(actions).toEqual([['owner-1', '/tmp/config', 'validate', 'check-config']]);
  await expect(page.getByRole('button', { name: 'Confirm reload' })).toBeEnabled();
});
