# Route Matching Algorithm

Matching compares **actual road geometry** produced by the routing provider, never place names.
Code: `backend/src/matching/` (`matching.repository.ts` – PostGIS, `domain/overlap.engine.ts` and
`domain/match-scoring.ts` – pure TypeScript, exhaustively unit-tested).

## 1. Candidate selection (PostGIS, index-driven)

For journey **A**, candidates **B** must satisfy, in SQL:
- status `PLANNED` or `ACTIVE`, different user, user active and opted in to matching;
- departure within `[depA − (window + durationB), depA + window + durationA]` — wide enough that a traveller who
  joins A's road later (e.g. Pune → Bengaluru vs Mumbai → Bengaluru) is still considered;
- `B.geom && expand(A.geom)` — bounding-box test on the **GiST index** (`journey_routes_geom_gix`);
- corridor test `ST_DWithin(simplified(B), simplified(A), corridor + 12 m)` on geography;
- optional vehicle-type filter; at most `maxCandidates` (300) ordered by departure proximity.

Simplification (`ST_Simplify` ≈ 3–11 m, then `ST_Segmentize` ≈ 1 km) collapses dense provider polylines so
corridor tests stay fast on 1,000 km routes, while keeping the spheroidal interpretation within centimetres of the
original path.

## 2. Measurement (PostGIS)

A is sampled at a fixed spheroidal spacing `step = max(50 m, length / 400)` with `ST_LineInterpolatePoints`. For every
candidate, PostGIS returns the samples that lie within the corridor (`corridorWidthMeters`, default **60 m**) of B and the
fractional position of the closest point on B (`ST_LineLocatePoint`). A cheap planar pre-check (tolerance sized for the
highest service latitude, so it can only over-include) runs before the exact spheroidal test.

## 3. Overlap analysis (pure TypeScript)

1. **Runs** – consecutive in-corridor samples form runs. Gaps of ≤ `maxGapSamples` (default 2, i.e. ~100 m) are bridged
   when the positions on B on both sides are consistent (absorbs GPS noise and junction geometry).
2. **Jump splitting** – if B's matched position jumps further than A could have travelled
   (`|Δb| > 1.5·Δa + 2·corridor`), the run is split. This handles loops, self-crossing routes and roads visited twice.
3. **Direction** – for each run, `direction = (bEnd − bStart)·lengthB / runLengthA`, clamped to [−1, 1].
   Same direction ≈ +1, **opposite direction ≈ −1**, a perpendicular crossing ≈ 0.
4. Runs with `direction ≥ minDirectionSimilarity` (default 0.5) are accepted. Direction compatibility is mandatory.
5. Outputs: shared distance (sum of accepted runs – each metre of A is counted once), overlap ratio for A and B,
   length-weighted direction similarity, convergence/divergence fractions, and the longest common segment (polyline).

## 4. Eligibility & scoring

Eligible when **all** hold (defaults from the brief; all configurable in the admin dashboard):

| Rule | Default |
|---|---|
| Shared road distance | ≥ 2 km |
| max(overlap A, overlap B) | ≥ 30 % (so Mumbai→Pune can match Mumbai→Bengaluru) |
| Direction similarity | ≥ 0.5 |
| Time difference **at the convergence point** | ≤ 30 min (each traveller's time = departure + duration × fraction travelled) |
| Pickup distance | scored; hard filter only if `requirePickupProximity` |

```
score = 100 × ( 0.40 · mean(overlapA, overlapB)
              + 0.25 · (1 − |Δt_convergence| / window)
              + 0.15 · direction rescaled to [0,1]
              + 0.10 · (1 − pickupDistance / pickupProximity)
              + 0.10 · (1 − destinationDistance / destinationProximity) )
confidence: HIGH ≥ 70, MEDIUM ≥ 45, LOW otherwise
```

**Match types**: `SAME_ROUTE` (both overlaps ≥ 85 %), `SAME_DESTINATION` (destinations ≤ 2 km),
`SHARED_START` (start together, overlap begins in first 10 % of both), otherwise `PARTIAL_OVERLAP`.

## 5. Persistence, deduplication and counts

- Results are stored in both directions (`journey_matches`, unique `(journey_id, matched_journey_id)`, CHECK
  `journey_id <> matched_journey_id`). A recomputation replaces both directions atomically.
- Cancelled, completed and expired journeys are removed from match rows immediately and excluded by every query.
- `GET /journeys/:id/matches` returns one row **per traveller** (best-scoring journey), plus: total matching journeys,
  distinct travellers, same-route vs partial-overlap travellers, and **vehicle-wise distinct travellers**.
- Per-road-stretch counts (`GET /journeys/:id/segments`) use 500 m grid cells along the route; a journey is counted at
  most once per cell and a traveller at most once per cell.

## 6. Verified edge cases

Unit tests (`overlap.engine.spec.ts`, `match-scoring.spec.ts`) and integration tests on real PostGIS geometry
(`test/integration/matching.int-spec.ts`) cover: identical routes, opposite direction, parallel road 150 m away, partial
overlap, converging routes, diverging routes, diverge-and-converge-again, perpendicular crossing, GPS jitter ±15 m,
roundabouts, self-crossing loops, small shared segments, zero-length & invalid geometry (DB CHECK constraints), missing
route, very short and very long (Mumbai → Bengaluru) journeys, time incompatibility, cancelled / completed / draft /
expired journeys, self-matching, opted-out users, duplicate users (dedup), concurrent journey creation, route
recalculation after edits.

## 7. Performance (measured)

`npm run benchmark:matching` (MacBook, Docker PostGIS, 2,000 planned journeys between 12 Pune localities in a 3-hour peak
— a deliberately dense worst case with ~1,300 bounding-box candidates per journey):

| Metric | Value |
|---|---|
| Candidate search uses GiST index | yes (`Index Scan using journey_routes_geom_gix`) |
| Full computation (search + measure + score + persist), p50 | ~1.0 s |
| p95 | ~1.4 s |
| Matches per journey | ~33 |

Computation runs in a background job, so request latency is unaffected. The launch target (1,000 journeys/day) needs
roughly 17 CPU-minutes/day at this worst-case density.

## 8. Accuracy limitations (honest)

- Two **different roads closer than the corridor** (e.g. a service road beside a highway, < 60 m) can be treated as the
  same road. Tightening `corridorWidthMeters` reduces this but increases sensitivity to GPS/polyline differences.
- Positions along B are planar fractions; at city scale the error is negligible, across 1,000 km it is a few percent and is
  absorbed by the jump/direction tolerances.
- Out-and-back routes on the same road are matched by nearest position and may be split into shorter runs.
- Timing uses uniform progress along the route (no per-segment speeds); the convergence time is an estimate.
- Overlap is measured from A's samples; overlap of B is shared distance / B length (symmetric to within sampling error).
- Matches describe **registered journeys**; they never imply people travel together. Ride sharing requires an explicit
  offer and acceptance.
