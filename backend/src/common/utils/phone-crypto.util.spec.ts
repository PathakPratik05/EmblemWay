import {
  generateNumericCode,
  generateOpaqueToken,
  hashPassword,
  hmacSha256,
  safeEqualHex,
  verifyPassword,
} from './crypto.util';
import { maskPhone, normalizePhone } from './phone.util';

describe('normalizePhone (India)', () => {
  it.each([
    ['+91', '9876543210', '+919876543210'],
    ['91', '9876543210', '+919876543210'],
    ['+91', '98765 43210', '+919876543210'],
    ['+91', '98765-43210', '+919876543210'],
    ['+91', '+919876543210', '+919876543210'],
    ['+91', '919876543210', '+919876543210'],
    ['+91', '09876543210', '+919876543210'],
    ['+91', '6000000000', '+916000000000'],
  ])('%s %s -> %s', (cc, n, e164) => {
    expect(normalizePhone(cc, n)).toEqual({
      ok: true,
      e164,
      countryCode: '+91',
      national: e164.slice(3),
    });
  });

  it.each([
    ['5876543210'], // must start with 6-9
    ['987654321'], // 9 digits
    ['98765432101'], // 11 digits
    ['98765abcde'],
    ['+449876543210'],
    [''],
  ])('rejects %p', (n) => {
    expect(normalizePhone('+91', n)).toEqual({ ok: false, reason: 'INVALID_NUMBER' });
  });

  it('rejects unsupported countries (expansion is data-driven)', () => {
    expect(normalizePhone('+1', '2025550123')).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_COUNTRY',
    });
  });

  it('masks numbers leaving only the last 4 digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ••••••3210');
    expect(maskPhone('+9')).toBe('••••');
  });
});

describe('crypto.util', () => {
  it('generates numeric codes of the requested length (leading zeros allowed)', () => {
    for (let i = 0; i < 200; i += 1) expect(generateNumericCode(6)).toMatch(/^\d{6}$/);
  });

  it('codes are not trivially repetitive', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateNumericCode(6)));
    expect(set.size).toBeGreaterThan(480);
  });

  it('hmac is deterministic per pepper and differs across peppers', () => {
    expect(hmacSha256('p1', 'x')).toBe(hmacSha256('p1', 'x'));
    expect(hmacSha256('p1', 'x')).not.toBe(hmacSha256('p2', 'x'));
    expect(hmacSha256('p1', 'x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('safeEqualHex compares in constant time and handles length mismatch', () => {
    const h = hmacSha256('p', 'v');
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hmacSha256('p', 'w'))).toBe(false);
    expect(safeEqualHex(h, h.slice(2))).toBe(false);
    expect(safeEqualHex('abc', 'abc')).toBe(false); // odd length is never valid hex digest
  });

  it('opaque tokens are url-safe and unique', () => {
    const a = generateOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(a).not.toBe(generateOpaqueToken());
  });

  it('password hashing round-trips and rejects wrong passwords / malformed hashes', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$16384$')).toBe(true);
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$whatever')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$1$a$b')).resolves.toBe(false);
  });
});
