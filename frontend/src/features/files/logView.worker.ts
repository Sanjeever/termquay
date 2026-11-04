import { renderLogView, type LogViewOptions } from './logView';

self.onmessage = (event: MessageEvent<{ content: string; options: LogViewOptions }>) => {
  try { self.postMessage(renderLogView(event.data.content, event.data.options)); }
  catch (error) { self.postMessage({ rows: [], matched: 0, scanned: 0, truncated: false, highlightLimited: false, formatted: 0, unformatted: 0, error: error instanceof Error ? error.message : String(error) }); }
};
