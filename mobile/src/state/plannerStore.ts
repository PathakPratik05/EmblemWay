import { create } from 'zustand';
import type { Place } from '../api/types';

export type LocationField = 'source' | 'destination' | 'pickup';

interface PlannerState {
  source: Place | null;
  destination: Place | null;
  pickup: Place | null;
  departureAt: Date;
  vehicleTypeCode: string | null;
  /** Stable per planning session: retries of "Save journey" reuse it (server-side idempotency). */
  idempotencyKey: string | null;
  setPlace: (field: LocationField, place: Place | null) => void;
  swap: () => void;
  setDeparture: (d: Date) => void;
  setVehicle: (code: string) => void;
  setIdempotencyKey: (k: string | null) => void;
  loadRoute: (r: {
    source: Place;
    destination: Place;
    pickup?: Place | null;
    vehicleTypeCode?: string | null;
    departureAt?: Date;
  }) => void;
  reset: () => void;
}

const nextQuarterHour = () => {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
};

export const usePlannerStore = create<PlannerState>(set => ({
  source: null,
  destination: null,
  pickup: null,
  departureAt: nextQuarterHour(),
  vehicleTypeCode: null,
  idempotencyKey: null,
  // Any change to the plan makes it a different request, so a new idempotency key is needed.
  setPlace: (field, place) =>
    set({ [field]: place, idempotencyKey: null } as Partial<PlannerState>),
  swap: () =>
    set(s => ({
      source: s.destination,
      destination: s.source,
      pickup: null,
      idempotencyKey: null,
    })),
  setDeparture: departureAt => set({ departureAt, idempotencyKey: null }),
  setVehicle: vehicleTypeCode => set({ vehicleTypeCode, idempotencyKey: null }),
  setIdempotencyKey: idempotencyKey => set({ idempotencyKey }),
  loadRoute: r =>
    set(s => ({
      source: r.source,
      destination: r.destination,
      pickup: r.pickup ?? null,
      vehicleTypeCode: r.vehicleTypeCode ?? s.vehicleTypeCode,
      departureAt: r.departureAt ?? s.departureAt,
      idempotencyKey: null,
    })),
  reset: () =>
    set({
      source: null,
      destination: null,
      pickup: null,
      departureAt: nextQuarterHour(),
      idempotencyKey: null,
    }),
}));
