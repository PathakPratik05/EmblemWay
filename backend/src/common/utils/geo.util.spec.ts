import {
  bearingDegrees,
  boxToPolygonWkt,
  decodePolyline,
  dedupeConsecutive,
  encodePolyline,
  gridCellFor,
  haversineMeters,
  INDIA_BBOX,
  isValidLatLng,
  isWithinBox,
  pathLengthMeters,
  resample,
  roundedCoordKey,
  toLineStringWkt,
} from './geo.util';

describe('geo.util', () => {
  describe('isValidLatLng', () => {
    it.each([
      [{ latitude: 18.52, longitude: 73.85 }, true],
      [{ latitude: 90, longitude: 180 }, true],
      [{ latitude: -90, longitude: -180 }, true],
      [{ latitude: 91, longitude: 73 }, false],
      [{ latitude: 18, longitude: 181 }, false],
      [{ latitude: Number.NaN, longitude: 73 }, false],
      [{ latitude: Number.POSITIVE_INFINITY, longitude: 73 }, false],
      [{ latitude: 0, longitude: 0 }, false], // "Null Island" = unset GPS fix
      [{ latitude: 18 } as never, false],
      [null, false],
      [undefined, false],
    ])('%j -> %s', (p, expected) => {
      expect(isValidLatLng(p as never)).toBe(expected);
    });
  });

  it('detects points inside the India service region', () => {
    expect(isWithinBox({ latitude: 18.52, longitude: 73.85 }, INDIA_BBOX)).toBe(true); // Pune
    expect(isWithinBox({ latitude: 51.5, longitude: -0.12 }, INDIA_BBOX)).toBe(false); // London
  });

  describe('haversineMeters', () => {
    it('is zero for identical points', () => {
      expect(
        haversineMeters({ latitude: 18.5, longitude: 73.8 }, { latitude: 18.5, longitude: 73.8 }),
      ).toBe(0);
    });
    it('measures one degree of latitude as ~111.2 km', () => {
      const d = haversineMeters({ latitude: 18, longitude: 73 }, { latitude: 19, longitude: 73 });
      expect(d).toBeGreaterThan(111_000);
      expect(d).toBeLessThan(111_400);
    });
    it('Pune station to Shivajinagar is about 2.9 km', () => {
      const d = haversineMeters(
        { latitude: 18.5289, longitude: 73.8744 },
        { latitude: 18.5308, longitude: 73.8475 },
      );
      expect(d).toBeGreaterThan(2_700);
      expect(d).toBeLessThan(3_000);
    });
    it('is symmetric', () => {
      const a = { latitude: 19.076, longitude: 72.8777 };
      const b = { latitude: 12.9716, longitude: 77.5946 };
      expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
    });
  });

  it('computes bearings for cardinal directions', () => {
    const o = { latitude: 18.5, longitude: 73.8 };
    expect(bearingDegrees(o, { latitude: 18.6, longitude: 73.8 })).toBeCloseTo(0, 0);
    expect(bearingDegrees(o, { latitude: 18.5, longitude: 73.9 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(o, { latitude: 18.4, longitude: 73.8 })).toBeCloseTo(180, 0);
    expect(bearingDegrees(o, { latitude: 18.5, longitude: 73.7 })).toBeCloseTo(270, 0);
  });

  describe('polyline codec', () => {
    // Example from Google's encoded polyline documentation.
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const points = [
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ];

    it('decodes the reference polyline', () => {
      const decoded = decodePolyline(encoded);
      expect(decoded).toHaveLength(3);
      decoded.forEach((p, i) => {
        expect(p.latitude).toBeCloseTo(points[i]!.latitude, 5);
        expect(p.longitude).toBeCloseTo(points[i]!.longitude, 5);
      });
    });

    it('encodes to the reference polyline', () => {
      expect(encodePolyline(points)).toBe(encoded);
    });

    it('round-trips real Pune coordinates within 1e-5 degrees', () => {
      const route = [
        { latitude: 18.59123, longitude: 73.73891 },
        { latitude: 18.57, longitude: 73.8 },
        { latitude: 18.55151, longitude: 73.93482 },
      ];
      decodePolyline(encodePolyline(route)).forEach((p, i) => {
        expect(Math.abs(p.latitude - route[i]!.latitude)).toBeLessThanOrEqual(1e-5);
        expect(Math.abs(p.longitude - route[i]!.longitude)).toBeLessThanOrEqual(1e-5);
      });
    });

    it('returns an empty list for an empty string', () => {
      expect(decodePolyline('')).toEqual([]);
    });

    it('throws on a truncated polyline', () => {
      expect(() => decodePolyline('_p~iF~ps|U_')).toThrow('Malformed polyline');
    });
  });

  describe('resample', () => {
    const line = [
      { latitude: 18.5, longitude: 73.8 },
      { latitude: 18.5, longitude: 73.81 }, // ~1055 m east
    ];

    it('produces evenly spaced samples including both ends', () => {
      const pts = resample(line, 100);
      expect(pts[0]).toEqual(line[0]);
      expect(pts[pts.length - 1]).toEqual(line[1]);
      for (let i = 1; i < pts.length - 1; i += 1) {
        expect(haversineMeters(pts[i - 1]!, pts[i]!)).toBeCloseTo(100, 0);
      }
      expect(pts.length).toBe(12); // 0,100,…,1000 + end
    });

    it('handles zero-length segments without producing NaN', () => {
      const pts = resample([line[0]!, line[0]!, line[1]!], 250);
      expect(pts.every((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))).toBe(
        true,
      );
    });

    it('returns [] for no points and rejects non-positive spacing', () => {
      expect(resample([], 50)).toEqual([]);
      expect(() => resample(line, 0)).toThrow();
    });

    it('preserves total length within 1% (sampling cuts corners at bends)', () => {
      const bent = [line[0]!, line[1]!, { latitude: 18.51, longitude: 73.81 }];
      const original = pathLengthMeters(bent);
      const sampled = pathLengthMeters(resample(bent, 37));
      expect(sampled).toBeLessThanOrEqual(original);
      expect((original - sampled) / original).toBeLessThan(0.01);
    });
  });

  it('dedupeConsecutive removes repeated vertices only', () => {
    const p = { latitude: 18.5, longitude: 73.8 };
    const q = { latitude: 18.6, longitude: 73.8 };
    expect(dedupeConsecutive([p, p, q, q, p])).toEqual([p, q, p]);
  });

  describe('gridCellFor', () => {
    it('assigns nearby points to the same cell and keys are stable', () => {
      const a = gridCellFor({ latitude: 18.52041, longitude: 73.85671 }, 1000);
      const b = gridCellFor({ latitude: 18.52042, longitude: 73.85672 }, 1000);
      expect(a.key).toBe(b.key);
      expect(a.key).toMatch(/^g1000:\d+:\d+$/);
    });

    it('cells are approximately square in metres', () => {
      const c = gridCellFor({ latitude: 18.52, longitude: 73.85 }, 1000);
      const width = haversineMeters(
        { latitude: c.center.latitude, longitude: c.bounds.minLng },
        { latitude: c.center.latitude, longitude: c.bounds.maxLng },
      );
      const height = haversineMeters(
        { latitude: c.bounds.minLat, longitude: c.center.longitude },
        { latitude: c.bounds.maxLat, longitude: c.center.longitude },
      );
      expect(width).toBeGreaterThan(990);
      expect(width).toBeLessThan(1010);
      expect(height).toBeGreaterThan(990);
      expect(height).toBeLessThan(1010);
    });

    it('contains the point within its bounds', () => {
      const p = { latitude: 12.9716, longitude: 77.5946 };
      const c = gridCellFor(p, 500);
      expect(p.latitude).toBeGreaterThanOrEqual(c.bounds.minLat);
      expect(p.latitude).toBeLessThan(c.bounds.maxLat);
      expect(p.longitude).toBeGreaterThanOrEqual(c.bounds.minLng);
      expect(p.longitude).toBeLessThan(c.bounds.maxLng);
    });
  });

  it('builds WKT in lng/lat order', () => {
    expect(
      toLineStringWkt([
        { latitude: 1, longitude: 2 },
        { latitude: 3, longitude: 4 },
      ]),
    ).toBe('LINESTRING(2 1, 4 3)');
    expect(boxToPolygonWkt({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 })).toBe(
      'POLYGON((3 1, 4 1, 4 2, 3 2, 3 1))',
    );
  });

  it('roundedCoordKey rounds to 4 decimals', () => {
    expect(roundedCoordKey({ latitude: 18.123456, longitude: 73.987654 })).toBe('18.1235,73.9877');
  });
});
