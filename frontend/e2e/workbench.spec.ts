import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
});

for (const platform of ['darwin', 'windows', 'linux']) {
  for (const width of [900, 1280]) {
    test(`tab actions follow tabs and remain reachable with overflow (${platform}, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.addInitScript((platform) => {
        Object.assign(window, { _wails: { environment: { OS: platform } } });
      }, platform);
      await page.goto('/e2e/fixture.html');
      const actions = page.locator('.workspace-tab-actions');
      const tabs = page.locator('.workspace-tabs');
      await expect(page.getByRole('tab', { name: 'Shell 1', exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const last = await page.locator('.workspace-tab:last-child').boundingBox();
          const buttons = await actions.boundingBox();
          return Math.abs(buttons!.x - last!.x - last!.width);
        })
        .toBeLessThan(1);
      await page.getByRole('button', { name: 'No workspaces', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'New local terminal', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open workspaces', exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('button', { name: 'Many workspaces', exact: true }).click();
      await expect(
        page.getByRole('tab', { name: 'Shell 20', exact: true, selected: true }),
      ).toBeVisible();
      await expect
        .poll(() => tabs.evaluate((element) => element.scrollWidth > element.clientWidth))
        .toBe(true);
      const position = await actions.boundingBox();
      await tabs.evaluate((element) => {
        element.scrollLeft = 0;
      });
      expect((await actions.boundingBox())!.x).toBe(position!.x);
      await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
      await page.getByRole('button', { name: 'Open workspaces', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Action counts')).toHaveText('1,1');
      await page.getByRole('tab', { name: 'Shell 20', exact: true }).focus();
      await page.keyboard.press('ArrowLeft');
      await expect(
        page.getByRole('tab', { name: 'Shell 19', exact: true, selected: true }),
      ).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

test('language, theme and custom font changes preserve the editor instance, selection and undo', async ({
  page,
}) => {
  await page.goto('/e2e/fixture.html');
  const editor = page.locator('.cm-content');
  await editor.fill('original changed');
  const view = await editor.evaluateHandle(async (element) => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(path);
    return EditorView.findFromDOM(element);
  });
  await view.evaluate((view) => view.dispatch({ selection: { anchor: 2, head: 6 } }));
  const original = await page.locator('.cm-editor').elementHandle();
  for (const name of ['Switch language', 'Switch theme', 'Use custom font']) {
    await page.getByRole('button', { name, exact: true }).click();
    expect(
      await original!.evaluate((element) => element === document.querySelector('.cm-editor')),
    ).toBe(true);
    expect(
      await view.evaluate((view) => ({
        text: view.state.doc.toString(),
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
      })),
    ).toEqual({ text: 'original changed', anchor: 2, head: 6 });
  }
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('html')).toHaveClass('dark');
  expect(
    await page.locator('.cm-scroller').evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain('FiraCode Nerd Font Mono');
  await page.getByRole('button', { name: /^撤销/ }).click();
  await expect(editor).toHaveText('original');
});

test('multiline clipboard confirmation sends one bracketed paste even when activated twice', async ({
  page,
}) => {
  const inputs: string[] = [];
  const text = 'first line\nsecond line';
  await page.route('**/wails/runtime*', (route) => {
    const body = route.request().postDataJSON();
    const clipboard = body?.object === 1 && body?.method === 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(clipboard ? text : null),
    });
  });
  await page.routeWebSocket('**/terminal-fixture', (socket) => {
    socket.onMessage((data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (frame[0] === 0) inputs.push(frame.subarray(1).toString('utf8'));
    });
    socket.send(Buffer.from('\x1b[?2004hready\r\n'));
  });
  await page.goto('/e2e/terminal.html');
  await expect(page.getByRole('button', { name: 'Terminal actions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Terminal actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.paste-preview')).toHaveText(text);
  await dialog
    .getByRole('button', { name: 'Paste into terminal', exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect.poll(() => inputs.join('')).toBe('\x1b[200~first line\rsecond line\x1b[201~');
  await expect(page.getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
});
