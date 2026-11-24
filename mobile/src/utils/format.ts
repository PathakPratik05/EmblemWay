import { DEFAULT_TIMEZONE } from '../config/env';

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters))
    return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return '—';
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Local (IST by default) time, e.g. "9:30 am". */
export function formatTime(
  iso: string | Date,
  timeZone = DEFAULT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** e.g. "Wed, 25 Nov · 9:30 am" */
export function formatDateTime(
  iso: string | Date,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
  return `${date} · ${formatTime(d, timeZone)}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86_400)} d ago`;
}

export const MATCH_TYPE_LABELS = {
  SAME_ROUTE: 'Same route',
  SAME_DESTINATION: 'Same destination',
  SHARED_START: 'Shared start',
  PARTIAL_OVERLAP: 'Partial overlap',
} as const;

export const STATUS_LABELS = {
  DRAFT: 'Draft',
  PLANNED: 'Planned',
  ACTIVE: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
} as const;
