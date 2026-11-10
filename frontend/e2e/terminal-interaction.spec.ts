import { expect, test, type Page } from '@playwright/test';

async function terminal(page: Page, output = '\x1b[?2004hready\r\n') {
  const inputs: string[] = [];
  let send: (data: string) => void = () => {
    throw new Error('terminal stream is not open');
  };
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.routeWebSocket('**/terminal-fixture', (socket) => {
    send = (data) => socket.send(Buffer.from(data));
    socket.onMessage((data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (frame[0] === 0) inputs.push(frame.subarray(1).toString('utf8'));
    });
    socket.send(Buffer.from(output));
  });
  await page.goto('/e2e/terminal.html?renderer=webgl');
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
  return { inputs, send: (data: string) => send(data) };
}

async function paste(page: Page, text: string) {
  await page.locator('.xterm-helper-textarea').evaluate((node, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    node.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

test('direct multiline paste is opt-in per session and retains bracketed paste across hiding', async ({
  page,
}) => {
  const { inputs } = await terminal(page);
  const text = '中文 prompt\nsecond line';
  await paste(page, text);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(inputs).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Terminal actions', exact: true }).click();
  const confirm = page.getByRole('menuitem', {
    name: 'Confirm multiline paste',
    exact: true,
  });
  await page.getByRole('menuitem', { name: 'Paste multiline text directly', exact: true }).click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  await paste(page, text);
  await expect.poll(() => inputs.join('')).toBe('\x1b[200~中文 prompt\rsecond line\x1b[201~');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Terminal actions', exact: true }).click();
  await confirm.click();
  await page.keyboard.press('Escape');
  await paste(page, text);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(inputs.join('')).toBe('\x1b[200~中文 prompt\rsecond line\x1b[201~');
});

test('new output preserves history browsing and offers a return to the live position', async ({
  page,
}) => {
  const output = Array.from({ length: 120 }, (_, index) => `line ${index}\r\n`).join('');
  const { send } = await terminal(page, '\x1b[?25l' + output);
  await page.locator('.xterm-screen').hover();
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(100);
  send('new live output\r\n');
  const button = page.getByRole('button', { name: 'New output', exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveCount(0);
  send('another live output\r\n');
  await page.waitForTimeout(50);
  await expect(button).toHaveCount(0);
});

test('interrupt, escape, tab navigation and modified input reach the PTY unchanged', async ({
  page,
}) => {
  const { inputs } = await terminal(page);
  await page.getByRole('textbox', { name: 'Terminal input' }).focus();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Control+j');
  await expect.poll(() => inputs.join('')).toBe('\x03\x1b\x1b\t\x1b[Z\n');
});

for (const windows of [false, true]) {
  test(`native image paste sends the TUI clipboard shortcut (${windows ? 'ConPTY' : 'legacy'})`, async ({
    page,
  }) => {
    const { inputs } = await terminal(
      page,
      (windows ? '\x1b[?9001h' : '') + '\x1b[?2004hready\r\n',
    );
    await page.route('**/wails/runtime*', (route) => {
      const body = route.request().postDataJSON();
      const value =
        body?.object === 1 && body?.method === 1
          ? ''
          : body?.args?.methodID === 3674738652
            ? true
            : null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    });
    await page.getByRole('button', { name: 'Terminal actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
    await expect
      .poll(() => inputs.join(''))
      .toBe(windows ? '\x1b[86;47;22;1;8;1_\x1b[86;47;22;0;8;1_' : '\x16');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('native file drops preserve quoted paths, target identity and input locking', async ({
  page,
}) => {
  const { inputs } = await terminal(page);
  const text = "'/work/a'\\''b.txt' ";
  await page.evaluate(
    (text) =>
      Reflect.get(window, '_wails').dispatchWailsEvent({
        name: 'local-terminal:files-dropped',
        data: { id: 'another-terminal', text },
      }),
    text,
  );
  expect(inputs).toEqual([]);
  await page.evaluate(
    (text) =>
      Reflect.get(window, '_wails').dispatchWailsEvent({
        name: 'local-terminal:files-dropped',
        data: { id: 'terminal-fixture', text },
      }),
    text,
  );
  await expect.poll(() => inputs.join('')).toBe(`\x1b[200~${text}\x1b[201~`);
  await page.getByRole('button', { name: 'Lock input', exact: true }).click();
  await expect(page.locator('.terminal-view')).not.toHaveAttribute('data-file-drop-target');
  await page.evaluate(
    (text) =>
      Reflect.get(window, '_wails').dispatchWailsEvent({
        name: 'local-terminal:files-dropped',
        data: { id: 'terminal-fixture', text },
      }),
    text,
  );
  await expect(page.getByRole('alert')).toContainText('locked');
  expect(inputs.join('')).toBe(`\x1b[200~${text}\x1b[201~`);
});
