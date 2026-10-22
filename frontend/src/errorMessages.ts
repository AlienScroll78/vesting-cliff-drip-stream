export interface ErrorInfo {
  title: string;
  explanation: string;
  action: string;
  faqUrl?: string
}

import type { TFunction } from 'i18next'

const FAQ_URLS: Record<number, string> = {
  1: '#faq-schedule-not-found',
  2: '#faq-cliff',
  5: '#faq-overflow',
}

/** Resolve contract error codes to localized, user-friendly messages. */
export function getErrorInfo(code: number, t: TFunction): ErrorInfo {
  const knownCode = code >= 1 && code <= 7;
  const key = knownCode ? `errors.${code}` : 'errors.unknown'
  return {
    title: t(`${key}.title`),
    explanation: t(`${key}.explanation`, { code }),
    action: t(`${key}.action`),
    faqUrl: FAQ_URLS[code],
  }
}
