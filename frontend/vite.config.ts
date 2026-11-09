import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'node:module';

// HeroUI providers and overlays must share the same locale context.
const heroRequire = createRequire(import.meta.resolve('@heroui/react'));
const modalRequire = createRequire(heroRequire.resolve('@heroui/modal'));
const overlayRequire = createRequire(modalRequire.resolve('@react-aria/overlays'));

export default defineConfig({
  resolve: { alias: { '@react-aria/i18n': overlayRequire.resolve('@react-aria/i18n') } },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [react(), tailwindcss(), wails("./bindings")],
  build: {
    rolldownOptions: {
      plugins: [{
        name: 'rdp-wasm-asset',
        transform(code, id) {
          if (!id.replaceAll('\\', '/').endsWith('/@devolutions/iron-remote-desktop-rdp/iron-remote-desktop-rdp.js')) return;
          const embedded = /"data:application\/wasm;base64,([A-Za-z0-9+/=]+)"/.exec(code);
          if (!embedded) this.error('RDP WASM 内嵌格式已变化，请检查资源提取');
          const reference = this.emitFile({ type: 'asset', name: 'iron-rdp.wasm', source: Buffer.from(embedded[1], 'base64') });
          return { code: code.replace(embedded[0], `import.meta.ROLLUP_FILE_URL_${reference}`), map: null };
        },
      }],
    },
  },
});
