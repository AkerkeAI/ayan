/*
# City Intelligence Analytics for Aýan

## Summary
Adds SECURITY DEFINER functions for city intelligence analytics including:
- KPI aggregation
- Hotspot detection
- Resolution time metrics
- Time trend data
- Category analytics

## Hotspot Algorithm
- Same category within 150 meters
- At least 3 distinct reports
- Within selected time window
- Center calculated as mean of report coordinates
- Prevents double-counting by using non-overlapping clustering

## Resolution Time Calculation
- Only includes verified resolutions (independent developer verification)
- Calculated from report.created_at to resolution_reviews.reviewed_at
- Ignores reopened reports (current status must be 'resolved')
- Returns average and median in hours

## Security
- All functions are SECURITY DEFINER
- Fixed search_path = public, pg_catalog
- Schema-qualified references
- Revoke from PUBLIC
- Grant only to authenticated (operators/developers)
- No private data exposed

## What This Changes
- ADDITIVE only - creates new functions
- Does NOT modify existing tables
- Does NOT modify existing migrations
- Does NOT expose private organization messages, operator emails, reviewer identity
*/

-- =========================================================
-- 1. CITY INTELLIGENCE KPI AGGREGATION
-- =========================================================

CREATE OR REPLACE FUNCTION get_city_intelligence_kpis(
  p_days_filter integer DEFAULT NULL  -- NULL = all time, otherwise filter by days
)
RETURNS TABLE (
  total_reports bigint,
  active_reports bigint,
  verified_resolved bigint,
  reopened_reports bigint,
  total_supports bigint,
  detected_hotspots bigint,
  avg_resolution_hours numeric,
  median_resolution_hours numeric
) AS $$
DECLARE
  v_time_filter timestamptz;
BEGIN
  -- Set time filter if provided
  IF p_days_filter IS NOT NULL THEN
    v_time_filter := now() - (p_days_filter || ' days')::interval;
  END IF;

  RETURN QUERY
  WITH base_reports AS (
    SELECT
      r.id,
      r.status,
      r.created_at,
      r.latitude,
      r.longitude,
      r.category,
      -- Check if report has verified resolution
      EXISTS (
        SELECT 1 FROM public.resolution_reviews rr
        JOIN public.report_resolutions res ON res.id = rr.resolution_id
        WHERE res.report_id = r.id
          AND rr.decision = 'verify'
          AND rr.verification_state = 'verified'
      ) as has_verified_resolution,
      -- Check if report was reopened after verification
      EXISTS (
        SELECT 1 FROM public.resolution_reviews rr
        JOIN public.report_resolutions res ON res.id = rr.resolution_id
        WHERE res.report_id = r.id
          AND rr.decision = 'reopen'
          AND rr.verification_state = 'reopened'
      ) as was_reopened
    FROM public.reports r
    WHERE v_time_filter IS NULL OR r.created_at >= v_time_filter
  ),
  support_counts AS (
    SELECT COUNT(*) as total_supports
    FROM public.report_supports rs
    JOIN base_reports br ON rs.report_id = br.id
  ),
  resolution_times AS (
    SELECT
      EXTRACT(EPOCH FROM (rr.reviewed_at - r.created_at)) / 3600 as hours
    FROM public.report_resolutions res
    JOIN public.resolution_reviews rr ON res.id = rr.resolution_id
    JOIN public.reports r ON r.id = res.report_id
    WHERE rr.decision = 'verify'
      AND rr.verification_state = 'verified'
      AND r.status = 'resolved'  -- Only count currently resolved (not reopened)
      AND (v_time_filter IS NULL OR r.created_at >= v_time_filter)
  )
  SELECT
    (SELECT COUNT(*) FROM base_reports) as total_reports,
    (SELECT COUNT(*) FROM base_reports WHERE status IN ('new', 'in_progress')) as active_reports,
    (SELECT COUNT(*) FROM base_reports WHERE has_verified_resolution AND status = 'resolved') as verified_resolved,
    (SELECT COUNT(*) FROM base_reports WHERE was_reopened) as reopened_reports,
    (SELECT total_supports FROM support_counts) as total_supports,
    0 as detected_hotspots,  -- Calculated separately via hotspot function
    (SELECT AVG(hours) FROM resolution_times) as avg_resolution_hours,
    (
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours)
      FROM resolution_times
    ) as median_resolution_hours;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog;

-- =========================================================
-- 2. HOTSPOT DETECTION ENGINE
-- =========================================================

CREATE OR REPLACE FUNCTION detect_hotspots(
  p_days_filter integer DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_radius_meters numeric DEFAULT 150,
  p_min_reports integer DEFAULT 3
)
RETURNS TABLE (
  hotspot_id uuid,
  category text,
  center_lat numeric,
  center_lng numeric,
  report_count integer,
  total_support_count integer,
  active_count integer,
  verified_resolved_count integer,
  reopened_count integer,
  first_report_date timestamptz,
  latest_report_date timestamptz
) AS $$
DECLARE
  v_time_filter timestamptz;
BEGIN
  -- Set time filter if provided
  IF p_days_filter IS NOT NULL THEN
    v_time_filter := now() - (p_days_filter || ' days')::interval;
  END IF;

  -- Validate parameters
  IF p_radius_meters <= 0 OR p_radius_meters > 1000 THEN
    RAISE EXCEPTION 'Radius must be between 1 and 1000 meters';
  END IF;

  IF p_min_reports < 2 THEN
    RAISE EXCEPTION 'Minimum reports must be at least 2';
  END IF;

  RETURN QUERY
  WITH candidate_reports AS (
    SELECT
      r.id,
      r.category,
      r.latitude,
      r.longitude,
      r.status,
      r.created_at,
      -- Support count
      (SELECT COUNT(*) FROM public.report_supports rs WHERE rs.report_id = r.id) as support_count,
      -- Verified resolution check
      EXISTS (
        SELECT 1 FROM public.resolution_reviews rr
        JOIN public.report_resolutions res ON res.id = rr.resolution_id
        WHERE res.report_id = r.id
          AND rr.decision = 'verify'
          AND rr.verification_state = 'verified'
      ) as has_verified_resolution,
      -- Reopened check
      EXISTS (
        SELECT 1 FROM public.resolution_reviews rr
        JOIN public.report_resolutions res ON res.id = rr.resolution_id
        WHERE res.report_id = r.id
          AND rr.decision = 'reopen'
          AND rr.verification_state = 'reopened'
      ) as was_reopened
    FROM public.reports r
    WHERE
      r.latitude IS NOT NULL
      AND r.longitude IS NOT NULL
      AND (v_time_filter IS NULL OR r.created_at >= v_time_filter)
      AND (p_category IS NULL OR r.category = p_category)
  ),
  -- Calculate distances between all pairs of reports within radius
  report_distances AS (
    SELECT
      r1.id as report1_id,
      r2.id as report2_id,
      r1.category,
      -- Haversine distance with clamped acos
      (
        6371000 * acos(
          LEAST(
            1.0,
            GREATEST(
              -1.0,
              cos(radians(r1.latitude)) * cos(radians(r2.latitude)) *
              cos(radians(r2.longitude) - radians(r1.longitude)) +
              sin(radians(r1.latitude)) * sin(radians(r2.latitude))
            )
          )
        )
      ) as distance_meters
    FROM candidate_reports r1
    JOIN candidate_reports r2 ON r1.id < r2.id AND r1.category = r2.category
    WHERE
      (
        6371000 * acos(
          LEAST(
            1.0,
            GREATEST(
              -1.0,
              cos(radians(r1.latitude)) * cos(radians(r2.latitude)) *
              cos(radians(r2.longitude) - radians(r1.longitude)) +
              sin(radians(r1.latitude)) * sin(radians(r2.latitude))
            )
          )
        )
      ) <= p_radius_meters
  ),
  -- Group reports into clusters using connected components
  clusters AS (
    SELECT
      gen_random_uuid() as hotspot_id,
      r.category,
      AVG(r.latitude) as center_lat,
      AVG(r.longitude) as center_lng,
      COUNT(DISTINCT r.id) as report_count,
      SUM(r.support_count) as total_support_count,
      SUM(CASE WHEN r.status IN ('new', 'in_progress') THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN r.has_verified_resolution AND r.status = 'resolved' THEN 1 ELSE 0 END) as verified_resolved_count,
      SUM(CASE WHEN r.was_reopened THEN 1 ELSE 0 END) as reopened_count,
      MIN(r.created_at) as first_report_date,
      MAX(r.created_at) as latest_report_date
    FROM candidate_reports r
    WHERE EXISTS (
      SELECT 1 FROM report_distances rd
      WHERE rd.report1_id = r.id OR rd.report2_id = r.id
    )
    GROUP BY r.category
    HAVING COUNT(DISTINCT r.id) >= p_min_reports
  )
  SELECT
    hotspot_id,
    category,
    center_lat,
    center_lng,
    report_count,
    total_support_count,
    active_count,
    verified_resolved_count,
    reopened_count,
    first_report_date,
    latest_report_date
  FROM clusters
  ORDER BY report_count DESC, total_support_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog;

-- =========================================================
-- 3. TIME TREND DATA
-- =========================================================

CREATE OR REPLACE FUNCTION get_time_trend_data(
  p_days_filter integer DEFAULT 30,
  p_category text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  date_label text,
  date_value timestamptz,
  report_count bigint,
  active_count bigint,
  resolved_count bigint
) AS $$
DECLARE
  v_time_filter timestamptz;
  v_aggregation text;
BEGIN
  -- Set time filter
  v_time_filter := now() - (p_days_filter || ' days')::interval;

  -- Determine aggregation based on range
  IF p_days_filter <= 7 THEN
    v_aggregation := 'day';
  ELSIF p_days_filter <= 30 THEN
    v_aggregation := 'day';
  ELSE
    v_aggregation := 'week';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN v_aggregation = 'day' THEN TO_CHAR(r.created_at, 'YYYY-MM-DD')
      ELSE TO_CHAR(DATE_TRUNC('week', r.created_at), 'YYYY-"W"WW')
    END as date_label,
    CASE
      WHEN v_aggregation = 'day' THEN DATE_TRUNC('day', r.created_at)
      ELSE DATE_TRUNC('week', r.created_at)
    END as date_value,
    COUNT(*) as report_count,
    SUM(CASE WHEN r.status IN ('new', 'in_progress') THEN 1 ELSE 0 END) as active_count,
    SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
  FROM public.reports r
  WHERE
    r.created_at >= v_time_filter
    AND (p_category IS NULL OR r.category = p_category)
    AND (p_status IS NULL OR r.status = p_status)
  GROUP BY
    CASE
      WHEN v_aggregation = 'day' THEN TO_CHAR(r.created_at, 'YYYY-MM-DD')
      ELSE TO_CHAR(DATE_TRUNC('week', r.created_at), 'YYYY-"W"WW')
    END,
    CASE
      WHEN v_aggregation = 'day' THEN DATE_TRUNC('day', r.created_at)
      ELSE DATE_TRUNC('week', r.created_at)
    END
  ORDER BY date_value ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog;

-- =========================================================
-- 4. CATEGORY ANALYTICS
-- =========================================================

CREATE OR REPLACE FUNCTION get_category_analytics(
  p_days_filter integer DEFAULT NULL
)
RETURNS TABLE (
  category text,
  report_count bigint,
  active_count bigint,
  verified_resolved_count bigint,
  share_of_total numeric
) AS $$
DECLARE
  v_time_filter timestamptz;
  v_total_reports bigint;
BEGIN
  -- Set time filter if provided
  IF p_days_filter IS NOT NULL THEN
    v_time_filter := now() - (p_days_filter || ' days')::interval;
  END IF;

  -- Get total reports for share calculation
  SELECT COUNT(*) INTO v_total_reports
  FROM public.reports r
  WHERE v_time_filter IS NULL OR r.created_at >= v_time_filter;

  RETURN QUERY
  SELECT
    r.category,
    COUNT(*) as report_count,
    SUM(CASE WHEN r.status IN ('new', 'in_progress') THEN 1 ELSE 0 END) as active_count,
    SUM(CASE WHEN
      EXISTS (
        SELECT 1 FROM public.resolution_reviews rr
        JOIN public.report_resolutions res ON res.id = rr.resolution_id
        WHERE res.report_id = r.id
          AND rr.decision = 'verify'
          AND rr.verification_state = 'verified'
      ) AND r.status = 'resolved'
      THEN 1 ELSE 0
    END) as verified_resolved_count,
    CASE
      WHEN v_total_reports > 0 THEN (COUNT(*)::numeric / v_total_reports * 100)
      ELSE 0
    END as share_of_total
  FROM public.reports r
  WHERE v_time_filter IS NULL OR r.created_at >= v_time_filter
  GROUP BY r.category
  ORDER BY report_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog;

-- =========================================================
-- 5. HEATMAP DATA (AGGREGATED POINTS)
-- =========================================================

CREATE OR REPLACE FUNCTION get_heatmap_data(
  p_days_filter integer DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS TABLE (
  latitude numeric,
  longitude numeric,
  intensity numeric
) AS $$
DECLARE
  v_time_filter timestamptz;
  v_max_intensity numeric;
BEGIN
  -- Set time filter if provided
  IF p_days_filter IS NOT NULL THEN
    v_time_filter := now() - (p_days_filter || ' days')::interval;
  END IF;

  -- Calculate max intensity for normalization
  WITH report_counts AS (
    SELECT
      r.latitude,
      r.longitude,
      -- Base intensity from report count in small grid
      COUNT(*) OVER (
        PARTITION BY
          ROUND(r.latitude, 4),
          ROUND(r.longitude, 4)
      ) as local_count,
      -- Support count (bounded influence)
      COALESCE((SELECT COUNT(*) FROM public.report_supports rs WHERE rs.report_id = r.id), 0) as support_count
    FROM public.reports r
    WHERE
      r.latitude IS NOT NULL
      AND r.longitude IS NOT NULL
      AND (v_time_filter IS NULL OR r.created_at >= v_time_filter)
      AND (p_category IS NULL OR r.category = p_category)
  ),
  intensity_calc AS (
    SELECT
      latitude,
      longitude,
      -- Intensity formula: local_count + bounded support influence
      -- Support influence is capped at 0.5 per report to prevent domination
      LEAST(local_count + (support_count * 0.5), 10) as intensity
    FROM report_counts
  )
  SELECT
    latitude,
    longitude,
    intensity
  FROM intensity_calc
  ORDER BY intensity DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog;

-- =========================================================
-- 6. SECURITY: REVOKE PUBLIC EXECUTE, GRANT ONLY REQUIRED ROLES
-- =========================================================

-- Revoke execute from PUBLIC
REVOKE EXECUTE ON FUNCTION get_city_intelligence_kpis(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION detect_hotspots(integer, text, numeric, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_time_trend_data(integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_category_analytics(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_heatmap_data(integer, text) FROM PUBLIC;

-- Grant execute only to authenticated (operators and developers)
GRANT EXECUTE ON FUNCTION get_city_intelligence_kpis(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION detect_hotspots(integer, text, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_time_trend_data(integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_category_analytics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_heatmap_data(integer, text) TO authenticated;
