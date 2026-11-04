export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message || error.name : String(error);
  return message.replace(/^(?:RuntimeError|Error):\s*/, '');
}

export function errorCode(error: unknown): string {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? code : '';
}
