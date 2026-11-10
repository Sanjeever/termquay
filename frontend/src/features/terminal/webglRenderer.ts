import type { Terminal } from '@xterm/xterm';
import type { WebglAddon } from '@xterm/addon-webgl';

const renderers = new Set<{ visible: boolean; loaded: boolean; release(): void }>();
const retainedRenderers = 8;

export function addWebGLRenderer(term: Terminal, fail: (error?: unknown) => void) {
  let addon: WebglAddon | undefined;
  let loss: { dispose(): void } | undefined;
  let visible = false;
  let disposed = false;
  let loading = false;
  let failed = false;
  const release = () => {
    loss?.dispose();
    loss = undefined;
    addon?.dispose();
    addon = undefined;
  };
  const renderer = {
    get visible() {
      return visible;
    },
    get loaded() {
      return !!addon;
    },
    release,
    setVisible(value: boolean) {
      visible = value;
      if (!value || disposed) return;
      renderers.delete(renderer);
      renderers.add(renderer);
      if (addon || loading || failed) return;
      loading = true;
      void import('@xterm/addon-webgl')
        .then(({ WebglAddon }) => {
          if (disposed) return;
          addon = new WebglAddon();
          loss = addon.onContextLoss(() => {
            release();
            failed = true;
            fail();
          });
          term.loadAddon(addon);
          let loaded = [...renderers].filter((entry) => entry.loaded).length;
          for (const entry of renderers) {
            if (loaded <= retainedRenderers) break;
            if (!entry.visible && entry.loaded) {
              entry.release();
              loaded--;
            }
          }
        })
        .catch((error) => {
          release();
          failed = true;
          if (!disposed) fail(error);
        })
        .finally(() => {
          loading = false;
        });
    },
    dispose() {
      disposed = true;
      renderers.delete(renderer);
      release();
    },
  };
  renderers.add(renderer);
  return renderer;
}
