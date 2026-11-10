// US or Canadian/British English and units, from the browser's locale. No
// settings: en-US gets American spelling and feet, everyone else (en-CA,
// en-GB, plain "en", fr-CA…) Canadian spelling and metres.

const FALLBACK_LOCALE = "en-CA";

/** The browser's locale, or en-CA where there's no navigator */
export function browserLocale(): string {
  if (typeof navigator === "undefined" || !navigator.language) return FALLBACK_LOCALE;
  return navigator.language;
}

/** Whether a locale's region is the United States (en-US, es-US) */
export function isAmericanLocale(locale: string = browserLocale()): boolean {
  try {
    return new Intl.Locale(locale).region === "US";
  } catch {
    return false;
  }
}

// Canadian spellings in user-visible text and their American forms
const AMERICAN_SPELLINGS: [RegExp, string][] = [
  [/\b([Ff])avourite/g, "$1avorite"],
  [/\b([Dd])raught/g, "$1raft"],
];

/**
 * Text as written (Canadian spelling), or with American spelling for a US
 * locale: "Favourites" → "Favorites", "Constrained by draught" → "Constrained by draft"
 */
export function spell(text: string, locale: string = browserLocale()): string {
  if (!isAmericanLocale(locale)) return text;
  return AMERICAN_SPELLINGS.reduce((out, [from, to]) => out.replace(from, to), text);
}
