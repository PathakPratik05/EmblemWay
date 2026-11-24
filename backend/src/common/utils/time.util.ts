export const IST_TIMEZONE = 'Asia/Kolkata';

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Floor a date to the start of an N-minute bucket (UTC aligned). */
export function floorToBucket(date: Date, bucketMinutes: number): Date {
  const ms = bucketMinutes * 60_000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

/** Human friendly local time, e.g. "24 Nov 2026, 09:30" in IST. */
export function formatLocal(date: Date, timeZone = IST_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatLocalTime(date: Date, timeZone = IST_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
