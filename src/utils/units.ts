import { browserLocale, isAmericanLocale } from "./locale";

const FEET_PER_METRE = 3.28084;

export interface LengthFormatOptions {
  locale?: string;
  /** Unit written out ("225 metres"), for aria labels and titles */
  spoken?: boolean;
}

/**
 * English with the locale's region, for formatting: the app is in English, so a
 * fr-CA browser gets "225 metres", not "225 mètres", inside English text
 */
export function englishLocale(locale: string): string {
  try {
    const region = new Intl.Locale(locale).region;
    return region ? `en-${region}` : "en";
  } catch {
    return "en-CA";
  }
}

/** Feet for a US locale, metres otherwise */
export function lengthUnit(locale: string = browserLocale()): "foot" | "meter" {
  return isAmericanLocale(locale) ? "foot" : "meter";
}

/** A length in metres in the locale's unit, rounded to a whole number */
export function convertLength(metres: number, locale: string = browserLocale()): number {
  return Math.round(lengthUnit(locale) === "foot" ? metres * FEET_PER_METRE : metres);
}

/** A ship's length, beam or draught given in metres: "225 m", or "738 ft" for en-US */
export function formatLength(metres: number, options: LengthFormatOptions = {}): string {
  const locale = options.locale ?? browserLocale();
  return new Intl.NumberFormat(englishLocale(locale), {
    style: "unit",
    unit: lengthUnit(locale),
    unitDisplay: options.spoken ? "long" : "short",
    maximumFractionDigits: 0,
  }).format(convertLength(metres, locale));
}

/** Just the number of a length in the locale's unit ("1,013"), for "1,013 × 105 ft" */
export function formatLengthNumber(metres: number, locale: string = browserLocale()): string {
  return new Intl.NumberFormat(englishLocale(locale), { maximumFractionDigits: 0 }).format(
    convertLength(metres, locale),
  );
}
