import { expect, test } from '@playwright/test';

test('WebGL retains its canvas and terminal while settings are open', async ({ page }) => {
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.routeWebSocket('**/terminal-fixture', (socket) => {
    socket.onMessage(() => {});
    socket.send(Buffer.from('retained terminal\r\n'));
  });
  await page.goto('/e2e/terminal.html?renderer=webgl');
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
  const canvas = await page.locator('.xterm canvas').first().elementHandle();
  const terminal = await page.locator('.xterm').elementHandle();
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  await expect(page.locator('.xterm canvas').first()).toBeHidden();
  await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
  expect(await canvas!.evaluate((node) => node === document.querySelector('.xterm canvas'))).toBe(
    true,
  );
  expect(await terminal!.evaluate((node) => node === document.querySelector('.xterm'))).toBe(true);
});

test('WebGL viewport follows device-pixel backing size changes', async ({ page }) => {
  await page.addInitScript(() => {
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) =>
          callback(
            entries.map((entry) =>
              entry.target instanceof HTMLCanvasElement
                ? new Proxy(entry, {
                    get(target, key) {
                      if (key === 'devicePixelContentBoxSize')
                        return [
                          {
                            inlineSize: Math.round(target.contentRect.width * 2),
                            blockSize: Math.round(target.contentRect.height * 2),
                          },
                        ];
                      return Reflect.get(target, key, target);
                    },
                  })
                : entry,
            ),
            observer,
          ),
        );
      }
    };
  });
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.routeWebSocket('**/terminal-fixture', (socket) => {
    socket.onMessage(() => {});
    socket.send(Buffer.from('\x1b[?25lbacking size\r\n'));
  });
  await page.goto('/e2e/terminal.html?renderer=webgl');
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.xterm-screen').evaluate((screen) => {
        for (const canvas of screen.querySelectorAll('canvas')) {
          const gl = canvas.getContext('webgl2');
          if (!gl) continue;
          const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
          return (
            canvas.width > canvas.clientWidth &&
            viewport[2] === gl.drawingBufferWidth &&
            viewport[3] === gl.drawingBufferHeight
          );
        }
        return false;
      }),
    )
    .toBe(true);
});

test('synchronized WebGL output keeps the previous frame until the update ends', async ({
  page,
}) => {
  const input: string[] = [];
  let send: (data: Buffer) => void = () => {
    throw new Error('terminal stream is not open');
  };
  await page.route('**/wails/runtime*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.routeWebSocket('**/terminal-fixture', (socket) => {
    send = (data) => socket.send(data);
    socket.onMessage((data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (frame[0] === 0) input.push(frame.subarray(1).toString('utf8'));
    });
    socket.send(Buffer.from('\x1b[?25lprevious frame\x1b[?2026$p'));
  });
  await page.goto('/e2e/terminal.html?renderer=webgl');
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
  await expect.poll(() => input.join('')).toContain('\x1b[?2026;2$y');
  await page.evaluate(() => document.fonts.ready);
  const screen = page.locator('.xterm-screen');
  const previous = await screen.screenshot();
  send(Buffer.from('\x1b[?2026h\r\x1b[2K'));
  await page.waitForTimeout(60);
  expect(await screen.screenshot()).toEqual(previous);
  send(Buffer.from('completed update\x1b[?2026l'));
  await expect.poll(async () => (await screen.screenshot()).equals(previous)).toBe(false);
});
