import { expect, test, type Page } from '@playwright/test';

async function openTerminal(page: Page, output = 'ready\r\n') {
  const inputs: string[] = [];
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.routeWebSocket('**/terminal-fixture', (socket) => {
    socket.onMessage((data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (frame[0] === 0) inputs.push(frame.subarray(1).toString('utf8'));
    });
    socket.send(Buffer.from(output));
  });
  await page.goto('/e2e/terminal.html');
  await page.getByRole('textbox', { name: 'Terminal input' }).focus();
  return inputs;
}

test('repeated local newline shortcuts cannot fall through as ordinary Enter', async ({ page }) => {
  const inputs: string[] = [];
  let attached = false;
  await page.addInitScript(() => {
    localStorage.setItem('termquay.shortcuts', JSON.stringify({ lineBreak: 'Shift+Enter' }));
  });
  await page.route('**/wails/runtime*', (route) => {
    const method = route.request().postDataJSON()?.args?.methodID;
    const values: Record<number, unknown> = {
      3198086081: { groups: [], connections: [], session_only: true },
      3288919527: { locked: false, available: false, idle_minutes: 0 },
      1509178199: { enabled: false, drafts: [] },
      2326168153: {},
      2007269789: {},
      841988121: { entries: [], active: '' },
      706236747: 0,
      3912183842: [{ id: 'shell', name: 'Shell' }],
      1947497108: [],
      2099865801: {
        id: 'local-shortcut-test',
        name: 'Shell',
        directory: '/work/project',
        hostname: 'computer',
      },
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(values[method] ?? null),
    });
  });
  await page.routeWebSocket('**/local-shortcut-fixture', (socket) => {
    socket.onMessage((data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (frame[0] === 0) inputs.push(frame.subarray(1).toString('utf8'));
      else if (frame.toString('utf8') === 'local-shortcut-test') attached = true;
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New local terminal', exact: true }).waitFor();
  await page.evaluate(() => {
    Reflect.get(window, '_wails').streamFactory = () => {
      const socket = new WebSocket(`ws://${location.host}/local-shortcut-fixture`);
      socket.binaryType = 'arraybuffer';
      return socket;
    };
  });
  await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
  await expect.poll(() => attached).toBe(true);
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.down('Shift');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.keyboard.up('Shift');
  await page.keyboard.down('a');
  await page.keyboard.down('a');
  await page.keyboard.up('a');
  await expect.poll(() => inputs.join('')).toBe('\x1b[13;2uaa');
  await page.keyboard.press('Enter');
  await expect.poll(() => inputs.join('')).toBe('\x1b[13;2uaa\r');
});

test('direct IME punctuation is sent once across keyup and repeated keydown events', async ({
  page,
}) => {
  const inputs = await openTerminal(page);
  for (const text of ['，', '。', '。']) {
    await page.locator('.xterm-helper-textarea').evaluate((element, text) => {
      const textarea = element as HTMLTextAreaElement;
      for (const type of ['keydown', 'keydown', 'keyup'])
        textarea.dispatchEvent(
          new KeyboardEvent(type, {
            key: 'Process',
            code: text === '，' ? 'Comma' : 'Period',
            keyCode: 229,
            bubbles: true,
            composed: true,
          }),
        );
      textarea.value += text;
      textarea.dispatchEvent(
        new InputEvent('input', {
          data: text,
          inputType: 'insertText',
          bubbles: true,
          composed: true,
        }),
      );
    }, text);
  }
  await page.waitForTimeout(50);
  expect(inputs).toEqual(['，', '。', '。']);
  await page.keyboard.type('abc');
  await expect.poll(() => inputs.join('')).toBe('，。。abc');
});

for (const keyCode of [229, 13])
  test(`IME candidate confirmation with keyCode ${keyCode} commits without submitting`, async ({
    page,
  }) => {
    const inputs = await openTerminal(page);
    await page.locator('.xterm-helper-textarea').evaluate(async (element, keyCode) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true }),
      );
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      textarea.value = '中文';
      textarea.dispatchEvent(
        new CompositionEvent('compositionupdate', { data: '中文', bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode,
          isComposing: true,
          bubbles: true,
        }),
      );
      textarea.dispatchEvent(
        new CompositionEvent('compositionend', { data: '中文', bubbles: true }),
      );
      textarea.dispatchEvent(
        new InputEvent('input', { data: '中文', inputType: 'insertText', bubbles: true }),
      );
    }, keyCode);
    await page.waitForTimeout(50);
    expect(inputs).toEqual(['中文']);
  });

test('direct IME input owns text even when keypress is also delivered', async ({ page }) => {
  const inputs = await openTerminal(page);
  await page.locator('.xterm-helper-textarea').evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true }),
    );
    textarea.dispatchEvent(
      new KeyboardEvent('keypress', { key: '，', keyCode: 65292, charCode: 65292, bubbles: true }),
    );
    textarea.value += '，';
    textarea.dispatchEvent(
      new InputEvent('input', { data: '，', inputType: 'insertText', bubbles: true }),
    );
  });
  await page.waitForTimeout(50);
  expect(inputs).toEqual(['，']);
});

test('ConPTY mode preserves Ctrl+J and modified Enter while ordinary input stays intact', async ({
  page,
}) => {
  const inputs = await openTerminal(page, '\x1b[?9001hready\r\n');
  await expect(page.locator('.xterm-screen')).toContainText('ready');
  await page.keyboard.press('Control+j');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('abc');
  await expect
    .poll(() => inputs.join(''))
    .toBe(
      '\x1b[74;36;10;1;8;1_\x1b[74;36;10;0;8;1_' +
        '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_' +
        '\x1b[13;28;13;1;2;1_\x1b[13;28;13;0;2;1_' +
        '\x1b[13;28;10;1;8;1_\x1b[13;28;10;0;8;1_' +
        '\rabc',
    );
});

test('legacy mode keeps LF and leaving ConPTY mode restores normal keyboard encoding', async ({
  page,
}) => {
  const inputs = await openTerminal(page, '\x1b[?9001h\x1b[?9001lready\r\n');
  await expect(page.locator('.xterm-screen')).toContainText('ready');
  await page.keyboard.press('Control+j');
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => inputs.join('')).toBe('\n\r');
});

test('copy on selection is opt-in, updates live and resets without recreating the terminal', async ({
  page,
}) => {
  await openTerminal(page, 'selectable text\r\n');
  const copies: string[] = [];
  await page.route('**/wails/runtime*', (route) => {
    const body = route.request().postDataJSON();
    if (body?.object === 1 && body?.method === 0) copies.push(body.args.text);
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  const terminal = await page.locator('.xterm').elementHandle();
  const line = page.locator('.xterm-rows > div').first();
  await expect(line).toContainText('selectable text');
  await page.locator('.xterm-screen').click({ clickCount: 3, position: { x: 20, y: 8 } });
  await page.waitForTimeout(50);
  expect(copies).toEqual([]);

  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  const preference = page.getByRole('switch', { name: 'Copy terminal selection on mouse release' });
  await expect(preference).not.toBeChecked();
  await preference.click();
  await expect(preference).toBeChecked();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('termquay.appearance')!).terminalCopyOnSelect,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  expect(await terminal!.evaluate((element) => element === document.querySelector('.xterm'))).toBe(
    true,
  );
  await page.locator('.xterm-screen').click({ clickCount: 3, position: { x: 20, y: 8 } });
  await expect.poll(() => copies.length).toBe(1);
  expect(copies[0].trim()).toBe('selectable text');

  await page.mouse.click(20, 200);
  await page.waitForTimeout(50);
  expect(copies).toHaveLength(1);
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await expect(preference).not.toBeChecked();
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  await page.locator('.xterm-screen').click({ clickCount: 3, position: { x: 20, y: 8 } });
  await page.waitForTimeout(50);
  expect(copies).toHaveLength(1);
});

test('selection release outside the terminal copies and clipboard failures remain visible', async ({
  page,
}) => {
  await openTerminal(page, 'selectable text\r\nend\r\n');
  const copies: string[] = [];
  let fail = false;
  await page.route('**/wails/runtime*', (route) => {
    const body = route.request().postDataJSON();
    const copy = body?.object === 1 && body?.method === 0;
    if (copy) copies.push(body.args.text);
    return route.fulfill({
      status: copy && fail ? 500 : 200,
      contentType: 'application/json',
      body: copy && fail ? JSON.stringify({ message: 'clipboard denied' }) : 'null',
    });
  });
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Copy terminal selection on mouse release' }).click();
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  const bounds = (await page.locator('.xterm-screen').boundingBox())!;
  const line = (await page.locator('.xterm-rows > div').first().boundingBox())!;
  await page.mouse.move(bounds.x + 1, bounds.y + line.height + 8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 8, { steps: 5 });
  await page.mouse.move(bounds.x + 100, bounds.y - 5);
  await page.mouse.up();
  await expect.poll(() => copies.length).toBe(1);
  expect(copies[0]).toContain('selectable');
  await page.locator('.xterm-screen').click({ button: 'right' });
  await page.waitForTimeout(50);
  expect(copies).toHaveLength(1);

  fail = true;
  await page.locator('.xterm-screen').click({ clickCount: 3, position: { x: 20, y: 8 } });
  await expect(page.getByRole('alert')).toContainText('clipboard denied');
});

for (const method of ['selection', 'menu', 'browser'] as const)
  test(`terminal copying removes line padding and preserves indentation and wrapped content (${method})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const wrapped = `  ${'ab'.repeat(150)}  END`;
    const output = [
      `  已完成。${' '.repeat(160)}`,
      ' '.repeat(187),
      `    mysql  --version${' '.repeat(120)}`,
      wrapped,
    ].join('\r\n');
    let sendOutput: () => void;
    let resized = false;
    const copies: string[] = [];
    await page.route('**/wails/runtime*', (route) => {
      const body = route.request().postDataJSON();
      if (body?.object === 1 && body?.method === 0) copies.push(body.args.text);
      if (body?.args?.methodID === 2615775029) resized = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    });
    await page.routeWebSocket('**/terminal-fixture', (socket) => {
      sendOutput = () => socket.send(Buffer.from(output));
    });
    await page.goto('/e2e/terminal.html');
    await expect.poll(() => resized).toBe(true);
    sendOutput!();
    if (method === 'selection') {
      await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
      await page.getByRole('switch', { name: 'Copy terminal selection on mouse release' }).click();
      await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
    }
    const rows = page.locator('.xterm-rows > div');
    await expect(rows.filter({ hasText: 'END' })).toBeVisible();
    const screen = (await page.locator('.xterm-screen').boundingBox())!;
    const first = (await rows.first().boundingBox())!;
    const last = (await rows.filter({ hasText: 'END' }).boundingBox())!;
    await page.mouse.move(screen.x + 1, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(screen.x + screen.width - 1, last.y + last.height / 2, { steps: 5 });
    await page.mouse.up();
    const eol = await page.evaluate(() => (navigator.platform.startsWith('Win') ? '\r\n' : '\n'));
    const expected = ['  已完成。', '', '    mysql  --version', wrapped].join(eol);
    if (method === 'menu') {
      await page.getByRole('button', { name: 'Terminal actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    }
    if (method === 'browser') {
      const copied = await page.locator('.xterm-helper-textarea').evaluate((element) => {
        const data = new DataTransfer();
        element.dispatchEvent(
          new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
        );
        return data.getData('text/plain');
      });
      expect(copied).toBe(expected);
    } else {
      await expect.poll(() => copies.length).toBe(1);
      expect(copies[0]).toBe(expected);
    }
  });
