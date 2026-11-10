import type { CustomTypeOptions } from 'i18next';

type Resources = CustomTypeOptions['resources'];
export type MessageKey =
  | {
      [Namespace in keyof Resources]: `${Namespace}:${Extract<keyof Resources[Namespace], string>}`;
    }[keyof Resources]
  | keyof Resources['common'];

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

export function message(code: MessageKey, parameters?: Record<string, unknown>) {
  return new MessageError(code, parameters);
}
