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
