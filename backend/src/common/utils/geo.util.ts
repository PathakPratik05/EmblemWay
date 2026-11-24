/**
 * Pure geospatial helpers (no I/O). Heavy spatial work happens in PostGIS; these helpers
 * cover validation, polyline encoding, light-weight distance maths and grid-cell keys.
 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180 &&
    // (0,0) "Null Island" is almost always a client bug (unset GPS fix).
    !(p.latitude === 0 && p.longitude === 0)
  );
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Service region for the launch (India). Configurable for future expansion. */
export const INDIA_BBOX: BoundingBox = { minLat: 6.5, maxLat: 37.5, minLng: 68.0, maxLng: 97.5 };

export function isWithinBox(p: LatLng, box: BoundingBox): boolean {
  return (
    p.latitude >= box.minLat &&
    p.latitude <= box.maxLat &&
    p.longitude >= box.minLng &&
    p.longitude <= box.maxLng
  );
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLng = (b.longitude - a.longitude) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * DEG) * Math.cos(b.latitude * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLengthMeters(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1]!, points[i]!);
  return total;
}

/** Initial bearing in degrees [0, 360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const φ1 = a.latitude * DEG;
  const φ2 = b.latitude * DEG;
  const Δλ = (b.longitude - a.longitude) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Linear interpolation between two coordinates (adequate for sub-kilometre steps). */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/**
 * Resample a polyline at a fixed spacing (metres). Always includes the first and last point.
 * Zero-length inputs return the de-duplicated input.
 */
export function resample(points: readonly LatLng[], spacingMeters: number): LatLng[] {
  if (spacingMeters <= 0) throw new Error('spacingMeters must be positive');
  if (points.length === 0) return [];
  const out: LatLng[] = [points[0]!];
  let carried = 0; // distance travelled since the last emitted sample
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = haversineMeters(a, b);
    if (seg === 0) continue;
    let pos = spacingMeters - carried; // distance along this segment of the next sample
    while (pos <= seg) {
      out.push(interpolate(a, b, pos / seg));
      pos += spacingMeters;
    }
    carried = seg - (pos - spacingMeters);
  }
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if (haversineMeters(tail, last) > 0.5) out.push(last);
  return out;
}

// ─── Google encoded polyline algorithm (precision 5) ────────────────────────

export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) throw new Error('Malformed polyline');
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push({ latitude: lat / factor, longitude: lng / factor });
  }
  return points;
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: readonly LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.latitude * factor);
    const lng = Math.round(p.longitude * factor);
    out += encodeSigned(lat - prevLat) + encodeSigned(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/** WKT LINESTRING in lng/lat order (PostGIS axis order). */
export function toLineStringWkt(points: readonly LatLng[]): string {
  return `LINESTRING(${points.map((p) => `${p.longitude} ${p.latitude}`).join(', ')})`;
}

/** Remove consecutive duplicate vertices (zero-length segments break some geometry ops). */
export function dedupeConsecutive(points: readonly LatLng[], toleranceMeters = 0.05): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || haversineMeters(prev, p) > toleranceMeters) out.push(p);
  }
  return out;
}

// ─── Metric grid cells ──────────────────────────────────────────────────────
// Rows are fixed-height bands; within each band the column width is adjusted by the
// band's latitude so every cell is approximately `cellSizeMeters` square.

const METERS_PER_DEG_LAT = 111_320;

export interface GridCell {
  key: string;
  row: number;
  col: number;
  center: LatLng;
  bounds: BoundingBox;
}

export function gridCellFor(p: LatLng, cellSizeMeters: number): GridCell {
  const dLat = cellSizeMeters / METERS_PER_DEG_LAT;
  const row = Math.floor(p.latitude / dLat);
  const rowCenterLat = (row + 0.5) * dLat;
  const dLng = cellSizeMeters / (METERS_PER_DEG_LAT * Math.cos(rowCenterLat * DEG));
  const col = Math.floor(p.longitude / dLng);
  const bounds: BoundingBox = {
    minLat: row * dLat,
    maxLat: (row + 1) * dLat,
    minLng: col * dLng,
    maxLng: (col + 1) * dLng,
  };
  return {
    key: `g${cellSizeMeters}:${row}:${col}`,
    row,
    col,
    center: { latitude: rowCenterLat, longitude: (col + 0.5) * dLng },
    bounds,
  };
}

export function boxToPolygonWkt(b: BoundingBox): string {
  return `POLYGON((${b.minLng} ${b.minLat}, ${b.maxLng} ${b.minLat}, ${b.maxLng} ${b.maxLat}, ${b.minLng} ${b.maxLat}, ${b.minLng} ${b.minLat}))`;
}

/** Stable key for caching route-level results: coordinates rounded to ~11 m. */
export function roundedCoordKey(p: LatLng, decimals = 4): string {
  return `${p.latitude.toFixed(decimals)},${p.longitude.toFixed(decimals)}`;
}
