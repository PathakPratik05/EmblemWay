import { z } from 'zod';

/**
 * Runtime-tunable thresholds. Defaults below are the *initial* values from the product
 * brief - they are deliberately not constants and can be changed from the admin dashboard.
 */
export const matchingSettingsSchema = z
  .object({
    /** Minimum length of shared road for a match (metres). */
    minSharedDistanceMeters: z.number().int().min(100).max(500_000).default(2000),
    /** Minimum share of either route that must overlap (0..1). */
    minOverlapRatio: z.number().min(0.01).max(1).default(0.3),
    /** Max difference between the times both travellers reach the shared stretch (minutes). */
    departureWindowMinutes: z.number().int().min(1).max(720).default(30),
    /** Half-width of the corridor in which two routes are considered "the same road" (metres). */
    corridorWidthMeters: z.number().int().min(10).max(300).default(60),
    /** Pickup proximity used for scoring (and filtering when requirePickupProximity=true). */
    pickupProximityMeters: z.number().int().min(100).max(200_000).default(5000),
    requirePickupProximity: z.boolean().default(false),
    /** Destinations closer than this count as "same destination". */
    destinationProximityMeters: z.number().int().min(50).max(50_000).default(2000),
    /** Minimum direction similarity (-1..1) of a shared run; opposite traffic is ~ -1. */
    minDirectionSimilarity: z.number().min(0).max(1).default(0.5),
    /** Overlap ratio on BOTH routes needed to classify as SAME_ROUTE. */
    sameRouteOverlapRatio: z.number().min(0.5).max(1).default(0.85),
    /** Sampling resolution limits for the overlap computation. */
    minSampleSpacingMeters: z.number().int().min(10).max(1000).default(50),
    maxSamplesPerRoute: z.number().int().min(50).max(2000).default(400),
    /** Max gap (in samples) bridged inside a shared run, absorbs GPS / snapping noise. */
    maxGapSamples: z.number().int().min(0).max(10).default(2),
    maxCandidates: z.number().int().min(10).max(2000).default(300),
  })
  .strict();

export const hotspotSettingsSchema = z
  .object({
    cellSizeMeters: z.number().int().min(200).max(10_000).default(1000),
    segmentCellSizeMeters: z.number().int().min(100).max(2000).default(500),
    bucketMinutes: z
      .number()
      .int()
      .refine((v) => [15, 30, 60, 120, 240, 1440].includes(v), 'Unsupported bucket')
      .default(60),
    lookbackDays: z.number().int().min(1).max(90).default(14),
  })
  .strict();

export const trafficSettingsSchema = z
  .object({
    /** A later departure is only "recommended" if it saves at least this many minutes... */
    significantImprovementMinutes: z.number().min(0).max(60).default(3),
    /** ...and at least this fraction of the leave-now duration. */
    significantImprovementRatio: z.number().min(0).max(1).default(0.05),
    /** Estimates older than this are labelled STALE and never shown as live. */
    staleAfterMinutes: z.number().int().min(1).max(120).default(15),
    /** Delay ratio (duration/static - 1) above which a traffic alert is sent. */
    alertDelayRatio: z.number().min(0.05).max(5).default(0.3),
  })
  .strict();

export const journeySettingsSchema = z
  .object({
    pastDepartureGraceMinutes: z.number().int().min(0).max(60).default(5),
    maxScheduleDaysAhead: z.number().int().min(1).max(365).default(90),
    /** PLANNED journeys not started this long after departure become EXPIRED. */
    expiryGraceMinutes: z.number().int().min(15).max(1440).default(120),
    /** ACTIVE journeys auto-complete after (route duration x factor + buffer). */
    autoCompleteDurationFactor: z.number().min(1).max(10).default(3),
    autoCompleteBufferMinutes: z.number().int().min(0).max(1440).default(120),
    reminderLeadMinutes: z.number().int().min(5).max(240).default(30),
  })
  .strict();

export const settingsSchemas = {
  matching: matchingSettingsSchema,
  hotspots: hotspotSettingsSchema,
  traffic: trafficSettingsSchema,
  journeys: journeySettingsSchema,
} as const;

export type SettingsKey = keyof typeof settingsSchemas;
export type MatchingSettings = z.infer<typeof matchingSettingsSchema>;
export type HotspotSettings = z.infer<typeof hotspotSettingsSchema>;
export type TrafficSettings = z.infer<typeof trafficSettingsSchema>;
export type JourneySettings = z.infer<typeof journeySettingsSchema>;
export type SettingsMap = {
  matching: MatchingSettings;
  hotspots: HotspotSettings;
  traffic: TrafficSettings;
  journeys: JourneySettings;
};

export const SETTINGS_KEYS = Object.keys(settingsSchemas) as SettingsKey[];

export function defaultSettings<K extends SettingsKey>(key: K): SettingsMap[K] {
  return settingsSchemas[key].parse({}) as SettingsMap[K];
}
