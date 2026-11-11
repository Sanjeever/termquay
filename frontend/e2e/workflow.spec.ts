import { expect, test, type Page } from '@playwright/test';

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

async function sshWorkflow(page: Page, language = 'en') {
  const calls: { method: number; args: unknown[] }[] = [];
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
    } else if (method === 272076810) value = { id: 'host-a-terminal-2' };
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
  await page.goto(`/e2e/workflow.html?scene=ssh&language=${language}`);
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

test('the actual tools menu opens a persistent file tab with the shared transfer panel', async ({
  page,
}) => {
  await page.route('**/wails/runtime*', async (route) => {
    const body = route.request().postDataJSON();
    const method = body?.args?.methodID;
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
  await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Connection center', exact: true }).click();
  await page.getByRole('tab', { name: 'File transfers', exact: true }).click();
  expect(
    await original!.evaluate(
      (element) => element === document.querySelector('.file-transfer-workspace'),
    ),
  ).toBe(true);
  await page.locator('[data-workspace-id="file-transfers"] .tab-close').click();
  await expect(page.getByRole('tab', { name: 'File transfers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toBeVisible();
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
