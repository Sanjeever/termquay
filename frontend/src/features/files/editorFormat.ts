export type EditorFormat = { encoding: string; line_ending: string; bom: boolean };
export const editorEncodings = [
  ['UTF-8', 'UTF-8'],
  ['GBK', 'ANSI（GBK）'],
  ['GB2312', 'GB2312'],
  ['GB18030', 'GB18030'],
] as const;
export function documentFormat(document: {
  content: string;
  encoding?: string;
  line_ending?: string;
  bom?: boolean;
}): EditorFormat {
  const remaining = document.content.replace(/\r\n/g, '');
  return {
    encoding: document.encoding || 'UTF-8',
    line_ending:
      document.line_ending ||
      (/\r/.test(remaining) || (/\r\n/.test(document.content) && /\n/.test(remaining))
        ? 'mixed'
        : /\r\n/.test(document.content)
          ? 'CRLF'
          : 'LF'),
    bom: !!document.bom,
  };
}
export function formatKey(document: {
  content: string;
  encoding?: string;
  line_ending?: string;
  bom?: boolean;
}) {
  return JSON.stringify(documentFormat(document));
}
