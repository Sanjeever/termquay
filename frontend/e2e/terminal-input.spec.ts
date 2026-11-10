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

test('IME candidate confirmation commits text without submitting the terminal', async ({
  page,
}) => {
  const inputs = await openTerminal(page);
  await page.locator('.xterm-helper-textarea').evaluate(async (element) => {
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
        keyCode: 229,
        isComposing: true,
        bubbles: true,
      }),
    );
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '中文', bubbles: true }));
    textarea.dispatchEvent(
      new InputEvent('input', { data: '中文', inputType: 'insertText', bubbles: true }),
    );
  });
  await page.waitForTimeout(50);
  expect(inputs).toEqual(['中文']);
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
