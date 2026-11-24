import type { JourneyStatus } from '@prisma/client';

/**
 * Journey lifecycle
 *
 *   DRAFT ──publish──▶ PLANNED ──start──▶ ACTIVE ──complete──▶ COMPLETED
 *     │                  │  │               │
 *     └──cancel──┐       │  └──expire──▶ EXPIRED   (system: departure + grace passed)
 *                ▼       ▼                  │
 *            CANCELLED ◀─┴──────cancel──────┘
 *
 * COMPLETED, CANCELLED and EXPIRED are terminal.
 */
export const JOURNEY_TRANSITIONS: Readonly<Record<JourneyStatus, readonly JourneyStatus[]>> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PLANNED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export type JourneyAction = 'publish' | 'start' | 'complete' | 'cancel' | 'expire';

export const ACTION_TARGET: Readonly<Record<JourneyAction, JourneyStatus>> = {
  publish: 'PLANNED',
  start: 'ACTIVE',
  complete: 'COMPLETED',
  cancel: 'CANCELLED',
  expire: 'EXPIRED',
};

export function canTransition(from: JourneyStatus, to: JourneyStatus): boolean {
  return JOURNEY_TRANSITIONS[from].includes(to);
}

/** Statuses from which `to` is reachable - used for race-free conditional UPDATEs. */
export function sourcesFor(to: JourneyStatus): JourneyStatus[] {
  return (Object.keys(JOURNEY_TRANSITIONS) as JourneyStatus[]).filter((from) =>
    canTransition(from, to),
  );
}

export function isTerminal(status: JourneyStatus): boolean {
  return JOURNEY_TRANSITIONS[status].length === 0;
}

/** Journeys in these states take part in matching, counts and hotspot demand. */
export const MATCHABLE_STATUSES: readonly JourneyStatus[] = ['PLANNED', 'ACTIVE'];
export const UPCOMING_STATUSES: readonly JourneyStatus[] = ['DRAFT', 'PLANNED', 'ACTIVE'];
export const HISTORY_STATUSES: readonly JourneyStatus[] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

/** Only not-yet-started journeys whose departure is still in the future may be edited. */
export function isEditable(status: JourneyStatus, departureAt: Date, now = new Date()): boolean {
  return (status === 'DRAFT' || status === 'PLANNED') && departureAt.getTime() > now.getTime();
}
