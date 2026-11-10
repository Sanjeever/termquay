import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../lib/errors.ts';

// Keep the original error/descriptor so an open notice follows language changes.
export function useMessageState(
  initial: unknown = '',
): [string, Dispatch<SetStateAction<unknown>>] {
  useTranslation();
  const [value, setValue] = useState(initial);
  return [value ? errorMessage(value) : '', setValue];
}
