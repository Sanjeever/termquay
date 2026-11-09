export type LanguagePreference = 'auto' | 'zh-CN' | 'en';
export type Language = Exclude<LanguagePreference, 'auto'>;

export function resolveLanguage(preference: LanguagePreference, languages: readonly string[]): Language {
  if (preference !== 'auto') return preference;
  for (const language of languages) {
    const tag = language.toLowerCase().replace(/_/g, '-');
    if (tag === 'zh' || tag === 'zh-cn' || tag === 'zh-sg' || /^zh-hans(?:-|$)/.test(tag)) return 'zh-CN';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}
