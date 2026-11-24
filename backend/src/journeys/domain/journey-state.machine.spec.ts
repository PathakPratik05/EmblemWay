import { JourneyStatus } from '@prisma/client';
import {
  ACTION_TARGET,
  canTransition,
  HISTORY_STATUSES,
  isEditable,
  isTerminal,
  JOURNEY_TRANSITIONS,
  MATCHABLE_STATUSES,
  sourcesFor,
} from './journey-state.machine';

const ALL: JourneyStatus[] = ['DRAFT', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'];

/** The complete, intended transition table. Every other pair must be rejected. */
const ALLOWED = new Set([
  'DRAFT>PLANNED',
  'DRAFT>CANCELLED',
  'PLANNED>ACTIVE',
  'PLANNED>CANCELLED',
  'PLANNED>EXPIRED',
  'ACTIVE>COMPLETED',
  'ACTIVE>CANCELLED',
]);

describe('journey state machine', () => {
  // 36 pairs -> exhaustive coverage of every possible transition.
  for (const from of ALL) {
    for (const to of ALL) {
      const allowed = ALLOWED.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${allowed ? 'allowed' : 'rejected'}`, () => {
        expect(canTransition(from, to)).toBe(allowed);
      });
    }
  }

  it('terminal states have no outgoing transitions', () => {
    expect(ALL.filter(isTerminal).sort()).toEqual(['CANCELLED', 'COMPLETED', 'EXPIRED']);
    for (const s of HISTORY_STATUSES) expect(JOURNEY_TRANSITIONS[s]).toEqual([]);
  });

  it('cancelled / completed / expired journeys are never matchable', () => {
    expect(MATCHABLE_STATUSES).toEqual(['PLANNED', 'ACTIVE']);
  });

  it('sourcesFor lists exactly the states that may reach a target', () => {
    expect(sourcesFor('CANCELLED').sort()).toEqual(['ACTIVE', 'DRAFT', 'PLANNED']);
    expect(sourcesFor('ACTIVE')).toEqual(['PLANNED']);
    expect(sourcesFor('COMPLETED')).toEqual(['ACTIVE']);
    expect(sourcesFor('EXPIRED')).toEqual(['PLANNED']);
    expect(sourcesFor('DRAFT')).toEqual([]);
  });

  it('each action maps to its target status', () => {
    expect(ACTION_TARGET).toEqual({
      publish: 'PLANNED',
      start: 'ACTIVE',
      complete: 'COMPLETED',
      cancel: 'CANCELLED',
      expire: 'EXPIRED',
    });
  });

  describe('isEditable', () => {
    const now = new Date('2026-11-25T03:00:00Z');
    const future = new Date('2026-11-25T04:00:00Z');
    const past = new Date('2026-11-25T02:00:00Z');
    it.each([
      ['DRAFT', future, true],
      ['PLANNED', future, true],
      ['PLANNED', past, false],
      ['ACTIVE', future, false],
      ['COMPLETED', future, false],
      ['CANCELLED', future, false],
      ['EXPIRED', future, false],
    ] as const)('%s departing %s -> %s', (status, dep, expected) => {
      expect(isEditable(status, dep, now)).toBe(expected);
    });
  });
});
