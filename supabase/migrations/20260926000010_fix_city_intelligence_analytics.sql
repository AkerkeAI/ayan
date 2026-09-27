-- Corrective Phase 4A migration. Apply manually AFTER 00009.
-- Read-only analytics functions; no records, tables, policies or Phase 1–3 functions changed.
BEGIN;

-- Shared report cohort. Internal only: API callers use aggregate functions below.
-- Period = report creation in a rolling window. NULL means all time.
-- Verified = currently resolved + current verified evidence + matching independent review.
-- Reopened = any historical reopen signal (developer OR resident), once per report.
CREATE OR REPLACE FUNCTION public.city_intelligence_facts(p_days_filter integer, p_category text)
RETURNS TABLE(id uuid,category text,status text,created_at timestamptz,latitude double precision,
 longitude double precision,supports bigint,verified boolean,reopened boolean,resolution_hours numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT (public.is_operator() OR public.is_developer()) THEN
  RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501';
 END IF;
 IF p_days_filter IS NOT NULL AND p_days_filter NOT IN (7,30,90) THEN
  RAISE EXCEPTION 'Invalid analytics period' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT r.id,r.category,r.status,r.created_at,r.latitude,r.longitude,
  (SELECT count(*) FROM public.report_supports s WHERE s.report_id=r.id),
  v.reviewed_at IS NOT NULL,
  EXISTS(SELECT 1 FROM public.report_events e WHERE e.report_id=r.id AND e.event_type='resolution_reopened')
   OR EXISTS(SELECT 1 FROM public.report_resolutions z WHERE z.report_id=r.id AND z.reopened_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.resolution_reviews a JOIN public.report_resolutions z ON z.id=a.resolution_id
     WHERE z.report_id=r.id AND a.decision='reopen' AND a.verification_state='reopened'),
  CASE WHEN v.reviewed_at>=r.created_at THEN extract(epoch FROM (v.reviewed_at-r.created_at))/3600 END
 FROM public.reports r
 LEFT JOIN LATERAL (
  SELECT max(a.reviewed_at) AS reviewed_at FROM public.report_resolutions z
  JOIN public.resolution_reviews a ON a.resolution_id=z.id AND a.reviewed_at=z.reviewed_at
  WHERE z.report_id=r.id AND r.status='resolved' AND z.state='verified'
   AND a.decision='verify' AND a.verification_state='verified'
   AND z.submitted_by IS NOT NULL AND a.reviewer_user_id<>z.submitted_by
 ) v ON true
 WHERE (p_days_filter IS NULL OR r.created_at>=now()-make_interval(days=>p_days_filter))
  AND r.created_at<=now() AND (p_category IS NULL OR r.category=p_category);
END $$;
REVOKE ALL ON FUNCTION public.city_intelligence_facts(integer,text) FROM PUBLIC,anon,authenticated;

-- New category-aware signature; keep original single-argument RPC compatible below.
CREATE OR REPLACE FUNCTION public.get_city_intelligence_summary(p_days_filter integer DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS TABLE(total_reports bigint,active_reports bigint,verified_resolved bigint,reopened_reports bigint,
 total_supports bigint,detected_hotspots bigint,avg_resolution_hours numeric,median_resolution_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT count(*),count(*) FILTER(WHERE f.status IN ('new','in_progress')),
 count(*) FILTER(WHERE f.verified),count(*) FILTER(WHERE f.reopened),coalesce(sum(f.supports),0)::bigint,
 0::bigint,avg(f.resolution_hours),
 (percentile_cont(0.5) WITHIN GROUP(ORDER BY f.resolution_hours))::numeric
 FROM public.city_intelligence_facts(p_days_filter,p_category) f;
$$;
CREATE OR REPLACE FUNCTION public.get_city_intelligence_kpis(p_days_filter integer DEFAULT NULL)
RETURNS TABLE(total_reports bigint,active_reports bigint,verified_resolved bigint,reopened_reports bigint,
 total_supports bigint,detected_hotspots bigint,avg_resolution_hours numeric,median_resolution_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT * FROM public.get_city_intelligence_summary(p_days_filter,NULL);
$$;

CREATE OR REPLACE FUNCTION public.detect_hotspots(p_days_filter integer DEFAULT NULL,p_category text DEFAULT NULL,
 p_radius_meters numeric DEFAULT 150,p_min_reports integer DEFAULT 3)
RETURNS TABLE(hotspot_id uuid,category text,center_lat numeric,center_lng numeric,report_count integer,
 total_support_count integer,active_count integer,verified_resolved_count integer,reopened_count integer,
 first_report_date timestamptz,latest_report_date timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF p_radius_meters IS NULL OR p_radius_meters<=0 OR p_radius_meters>1000
  OR p_min_reports IS NULL OR p_min_reports<3 THEN
  RAISE EXCEPTION 'Invalid hotspot parameters' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 WITH RECURSIVE candidates AS MATERIALIZED (
  SELECT * FROM public.city_intelligence_facts(p_days_filter,p_category) f
  WHERE f.latitude BETWEEN -90 AND 90 AND f.longitude BETWEEN -180 AND 180
 ), edges AS (
  SELECT a.id AS a_id,b.id AS b_id FROM candidates a JOIN candidates b ON a.category=b.category
  WHERE a.id=b.id OR 6371000*acos(least(1.0,greatest(-1.0,
   cos(radians(a.latitude))*cos(radians(b.latitude))*cos(radians(b.longitude-a.longitude))+
   sin(radians(a.latitude))*sin(radians(b.latitude)))))<=p_radius_meters
 ), reach(root,node) AS (
  SELECT c.id,c.id FROM candidates c
  UNION
  SELECT r.root,e.b_id FROM reach r JOIN edges e ON e.a_id=r.node
 ), membership AS (
  SELECT r.node,min(r.root::text)::uuid AS cluster_id FROM reach r GROUP BY r.node
 )
 SELECT m.cluster_id,c.category,avg(c.latitude)::numeric,avg(c.longitude)::numeric,count(*)::integer,
 sum(c.supports)::integer,count(*) FILTER(WHERE c.status IN ('new','in_progress'))::integer,
 count(*) FILTER(WHERE c.verified)::integer,count(*) FILTER(WHERE c.reopened)::integer,
 min(c.created_at),max(c.created_at)
 FROM candidates c JOIN membership m ON m.node=c.id GROUP BY m.cluster_id,c.category
 HAVING count(*)>=p_min_reports ORDER BY count(*) DESC,m.cluster_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_time_trend_data(p_days_filter integer DEFAULT 30,p_category text DEFAULT NULL,p_status text DEFAULT NULL)
RETURNS TABLE(date_label text,date_value timestamptz,report_count bigint,active_count bigint,resolved_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 WITH cohort AS MATERIALIZED (
  SELECT * FROM public.city_intelligence_facts(p_days_filter,p_category) f WHERE p_status IS NULL OR f.status=p_status
 ), grain AS (
  SELECT CASE WHEN p_days_filter IN (7,30) THEN 'day'
   WHEN p_days_filter IS NULL AND max(c.created_at)-min(c.created_at)>interval '365 days' THEN 'month'
   ELSE 'week' END AS unit FROM cohort c
 ), buckets AS (
  SELECT date_trunc(g.unit,c.created_at AT TIME ZONE 'Asia/Aqtau') AT TIME ZONE 'Asia/Aqtau' AS bucket,c.*
  FROM cohort c CROSS JOIN grain g
 )
 SELECT to_char(b.bucket AT TIME ZONE 'Asia/Aqtau','DD.MM.YYYY'),b.bucket,count(*),
 count(*) FILTER(WHERE b.status IN ('new','in_progress')),count(*) FILTER(WHERE b.verified)
 FROM buckets b GROUP BY b.bucket ORDER BY b.bucket;
$$;

-- Retained for compatibility, no longer requested by the analytics page.
CREATE OR REPLACE FUNCTION public.get_category_analytics(p_days_filter integer DEFAULT NULL)
RETURNS TABLE(category text,report_count bigint,active_count bigint,verified_resolved_count bigint,share_of_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 WITH cohort AS MATERIALIZED(SELECT * FROM public.city_intelligence_facts(p_days_filter,NULL))
 SELECT f.category,count(*),count(*) FILTER(WHERE f.status IN ('new','in_progress')),
 count(*) FILTER(WHERE f.verified),count(*)::numeric/nullif((SELECT count(*) FROM cohort),0)*100
 FROM cohort f GROUP BY f.category ORDER BY count(*) DESC,f.category;
$$;

-- Each report contributes exactly once; supports add at most half a report's weight.
-- Leaflet.heat blends nearby points. No hotspot threshold or rounded synthetic coordinates.
CREATE OR REPLACE FUNCTION public.get_heatmap_data(p_days_filter integer DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS TABLE(latitude numeric,longitude numeric,intensity numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT f.latitude::numeric,f.longitude::numeric,1::numeric+least(f.supports,5)::numeric/10
 FROM public.city_intelligence_facts(p_days_filter,p_category) f
 WHERE f.latitude BETWEEN -90 AND 90 AND f.longitude BETWEEN -180 AND 180 ORDER BY f.id;
$$;

REVOKE ALL ON FUNCTION public.get_city_intelligence_summary(integer,text),public.get_city_intelligence_kpis(integer),
 public.detect_hotspots(integer,text,numeric,integer),public.get_time_trend_data(integer,text,text),
 public.get_category_analytics(integer),public.get_heatmap_data(integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_city_intelligence_summary(integer,text),public.get_city_intelligence_kpis(integer),
 public.detect_hotspots(integer,text,numeric,integer),public.get_time_trend_data(integer,text,text),
 public.get_category_analytics(integer),public.get_heatmap_data(integer,text) TO authenticated;
COMMIT;
