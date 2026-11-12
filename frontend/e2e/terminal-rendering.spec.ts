import { expect, test } from '@playwright/test';

test.describe('fractional DPI glyph alignment', () => {
  test.use({ deviceScaleFactor: 1.25 });

  test('Chinese glyphs retain identical pixels across terminal rows', async ({ page }) => {
    await page.goto('/e2e/terminal.html');
    const pixels = await page.evaluate(async () => {
      const xtermModule = '/node_modules/.vite/deps/@xterm_xterm.js';
      const webglModule = '/node_modules/.vite/deps/@xterm_addon-webgl.js';
      const appearanceModule = '/src/features/settings/appearance.ts';
      const { Terminal } = await import(xtermModule);
      const { WebglAddon } = await import(webglModule);
      const { monoFonts } = await import(appearanceModule);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;padding:8px;z-index:10000';
      document.body.append(host);
      const terminal = new Terminal({
        cols: 120,
        rows: 32,
        fontFamily: monoFonts.system,
        fontSize: 14,
        lineHeight: 1.3,
        cursorBlink: false,
      });
      terminal.open(host);
      const addon = new WebglAddon(true);
      terminal.loadAddon(addon);
      try {
        await new Promise<void>((resolve) =>
          terminal.write('\x1b[?25l' + Array(31).fill('还是很模糊 ABC123').join('\r\n'), resolve),
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        const renderer = Reflect.get(addon, '_renderer');
        const gl = Reflect.get(renderer, '_gl') as WebGL2RenderingContext;
        renderer.renderRows(0, terminal.rows - 1);
        const height = renderer.dimensions.device.cell.height as number;
        const samples = [0, 10, 20].map((row) => {
          const sample = new Uint8Array(70 * height * 4);
          gl.readPixels(
            0,
            gl.drawingBufferHeight - (row + 1) * height,
            70,
            height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            sample,
          );
          return Array.from(sample);
        });
        return {
          ink: samples[0].filter((value, index) => index % 4 !== 3 && value > 60).length,
          samples,
        };
      } finally {
        terminal.dispose();
        host.remove();
      }
    });
    expect(pixels.ink).toBeGreaterThan(100);
    expect(pixels.samples[1]).toEqual(pixels.samples[0]);
    expect(pixels.samples[2]).toEqual(pixels.samples[0]);
  });
});

for (const renderer of ['dom', 'webgl']) {
  test(`Windows ${renderer} terminal presets use explicit Chinese fallback fonts`, async ({
    page,
  }) => {
    test.skip(process.platform !== 'win32', 'Checks installed Windows font selection');
    test.setTimeout(60000);
    await page.addInitScript(() => {
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        if (/\p{Script=Han}/u.test(args[0])) Reflect.set(window, 'terminalCjkDrawFont', this.font);
        return fillText.apply(this, args);
      };
    });
    await page.route('**/wails/runtime*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
    );
    await page.routeWebSocket('**/terminal-fixture', (socket) => {
      socket.onMessage(() => {});
      socket.send(Buffer.from('TermQuay ABC123\r\n微信小程序支付，你有什么看法？\r\n'));
    });
    await page.goto(`/e2e/terminal.html?renderer=${renderer}`);
    await expect(page.locator('.xterm')).toBeVisible();
    const terminal = await page.locator('.xterm').elementHandle();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const fontsFor = async (selector: string) => {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      return (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
    };
    await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.id = 'cjk-font-probe';
      probe.textContent = '微信小程序支付';
      probe.style.cssText = 'position:absolute;top:0;opacity:0;font:16px "Microsoft YaHei UI"';
      document.body.append(probe);
    });
    test.skip(
      !(await fontsFor('#cjk-font-probe')).some((font) => font.familyName === 'Microsoft YaHei UI'),
      'Microsoft YaHei UI is not installed',
    );
    for (const name of ['Cascadia Mono', 'Consolas', 'JetBrains Mono']) {
      await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
      await page.locator('.settings-section .select-control').first().getByRole('button').click();
      await page.getByRole('option', { name, exact: true }).click();
      await page.getByRole('button', { name: 'Terminal settings', exact: true }).click();
      const drawFont = () =>
        page.evaluate((renderer) => {
          const style = document.createElement('span').style;
          style.fontFamily = getComputedStyle(document.documentElement).getPropertyValue(
            '--font-mono',
          );
          const expectedFamily = style.fontFamily;
          const rows = document.querySelector('.xterm-rows');
          const computed = rows && getComputedStyle(rows);
          const font =
            renderer === 'webgl'
              ? (Reflect.get(window, 'terminalCjkDrawFont') as string | undefined)
              : computed && `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
          if (!font) return;
          style.font = font;
          return style.fontFamily === expectedFamily ? font : undefined;
        }, renderer);
      await expect.poll(drawFont).toBeTruthy();
      const font = (await drawFont())!;
      await page.evaluate((font) => {
        document.getElementById('cjk-font-probe')!.style.font = font;
      }, font);
      const cjk = await fontsFor('#cjk-font-probe');
      expect(cjk.map((font) => font.familyName)).toEqual(['Microsoft YaHei UI']);
      await page.evaluate(() => {
        document.getElementById('cjk-font-probe')!.textContent = 'TermQuay ABC123';
      });
      const latin = await fontsFor('#cjk-font-probe');
      expect(latin.length).toBeGreaterThan(0);
      expect(
        latin.every((font) =>
          ['Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Liberation Mono'].includes(
            font.familyName,
          ),
        ),
      ).toBe(true);
      await page.evaluate(() => {
        document.getElementById('cjk-font-probe')!.textContent = '微信小程序支付';
      });
      expect(await terminal!.evaluate((node) => node === document.querySelector('.xterm'))).toBe(
        true,
      );
    }
    await cdp.detach();
  });
}

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
