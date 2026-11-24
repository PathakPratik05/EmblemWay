/**
 * Phone number normalisation. Country rules are data-driven so new countries can be
 * added without touching callers. India is the launch market.
 */
export interface CountryPhoneRule {
  countryCode: string; // e.g. "+91"
  iso: string;
  nationalPattern: RegExp;
  label: string;
}

export const SUPPORTED_COUNTRY_CODES: readonly CountryPhoneRule[] = [
  // Indian mobile numbers: 10 digits starting with 6, 7, 8 or 9.
  { countryCode: '+91', iso: 'IN', nationalPattern: /^[6-9]\d{9}$/, label: 'India' },
];

export type PhoneParseResult =
  | { ok: true; e164: string; countryCode: string; national: string }
  | { ok: false; reason: 'UNSUPPORTED_COUNTRY' | 'INVALID_NUMBER' };

export function normalizePhone(countryCode: string, rawNumber: string): PhoneParseResult {
  const trimmed = countryCode.trim();
  const cc = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  const rule = SUPPORTED_COUNTRY_CODES.find((r) => r.countryCode === cc);
  if (!rule) return { ok: false, reason: 'UNSUPPORTED_COUNTRY' };

  let digits = rawNumber.replace(/[\s\-().]/g, '');
  const ccDigits = cc.slice(1);
  if (digits.startsWith('+')) {
    if (!digits.startsWith(cc)) return { ok: false, reason: 'INVALID_NUMBER' };
    digits = digits.slice(cc.length);
  } else if (digits.length === 10 + ccDigits.length && digits.startsWith(ccDigits)) {
    digits = digits.slice(ccDigits.length);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1); // trunk prefix, e.g. 09876543210
  }
  if (!/^\d+$/.test(digits) || !rule.nationalPattern.test(digits)) {
    return { ok: false, reason: 'INVALID_NUMBER' };
  }
  return { ok: true, e164: `${cc}${digits}`, countryCode: cc, national: digits };
}

/** "+919876543210" -> "+91 ••••••3210" (for logs & UI; never reveal full numbers). */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return '••••';
  return `${e164.slice(0, 3)} ••••••${e164.slice(-4)}`;
}
