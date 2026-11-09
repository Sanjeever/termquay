export class MessageError extends Error {
  readonly messageCode: string;
  readonly parameters: Record<string, unknown>;
  constructor(messageCode: string, parameters: Record<string, unknown> = {}) {
    super(messageCode);
    this.name = 'MessageError';
    this.messageCode = messageCode;
    this.parameters = parameters;
  }
}

export function message(code: string, parameters?: Record<string, unknown>) {
  return new MessageError(code, parameters);
}
