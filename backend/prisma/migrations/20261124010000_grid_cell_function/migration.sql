-- Metric grid cell used by hotspot aggregation. MUST stay identical to gridCellFor()
-- in src/common/utils/geo.util.ts (verified by test/integration/geo-parity.int-spec.ts).
-- Rows are fixed-height latitude bands; column width is scaled by the band's latitude so
-- every cell is approximately size_m × size_m.
CREATE OR REPLACE FUNCTION emblemway_grid_cell(lat double precision, lng double precision, size_m integer)
RETURNS TABLE (cell_key text, center_lat double precision, center_lng double precision)
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  WITH r AS (
    SELECT floor(lat / (size_m / 111320.0))::bigint AS row_idx, size_m / 111320.0 AS dlat
  ), c AS (
    SELECT r.row_idx, r.dlat,
           size_m / (111320.0 * cos(radians((r.row_idx + 0.5) * r.dlat))) AS dlng
      FROM r
  )
  SELECT 'g' || size_m || ':' || c.row_idx || ':' || floor(lng / c.dlng)::bigint,
         (c.row_idx + 0.5) * c.dlat,
         (floor(lng / c.dlng) + 0.5) * c.dlng
    FROM c
$$;
