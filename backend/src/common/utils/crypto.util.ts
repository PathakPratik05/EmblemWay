import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 hex digest - used to store OTPs and refresh tokens without keeping the secret value. */
export function hmacSha256(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Cryptographically secure numeric code; leading zeros allowed (e.g. "004217"). */
export function generateNumericCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10).toString();
  return out;
}

export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Password hash in the form `scrypt$N$saltB64$hashB64`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || Number(n) !== SCRYPT_N || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
