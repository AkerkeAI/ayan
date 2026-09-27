-- Phase 4B. Apply manually after 00010. No data writes or Phase 1–4A replacements.
BEGIN;

-- Named configuration constants. Change through a reviewed future migration.
CREATE OR REPLACE FUNCTION public.city_intelligence_4b_config()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
 SELECT jsonb_build_object('spatial_radius_meters',150,'min_distinct_reports',3,
  'recurrence_span_days',7,'unresolved_days',14,'min_resolution_samples',3);
$$;
REVOKE ALL ON FUNCTION public.city_intelligence_4b_config() FROM PUBLIC,anon,authenticated;

-- Private component membership, same connected-component definition and stable ID as 4A.
-- Latitude prefilter reduces distance evaluations; all clustering stays in PostgreSQL.
CREATE OR REPLACE FUNCTION public.city_intelligence_4b_members(p_days_filter integer,p_category text)
RETURNS TABLE(report_id uuid,hotspot_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 WITH RECURSIVE config AS (SELECT (public.city_intelligence_4b_config()->>'spatial_radius_meters')::double precision AS radius),
 candidates AS MATERIALIZED (
  SELECT f.id,f.category,f.latitude,f.longitude FROM public.city_intelligence_facts(p_days_filter,p_category) f
  WHERE f.latitude BETWEEN -90 AND 90 AND f.longitude BETWEEN -180 AND 180
 ), edges AS (
  SELECT a.id AS a_id,b.id AS b_id FROM candidates a JOIN candidates b ON a.category=b.category CROSS JOIN config c
  WHERE abs(a.latitude-b.latitude)<=degrees(c.radius/6371000.0)+0.00000001
  AND (a.id=b.id OR 6371000*acos(least(1.0,greatest(-1.0,
   cos(radians(a.latitude))*cos(radians(b.latitude))*cos(radians(b.longitude-a.longitude))+
   sin(radians(a.latitude))*sin(radians(b.latitude)))))<=c.radius)
 ), reach(root,node) AS (
  SELECT c.id,c.id FROM candidates c UNION
  SELECT r.root,e.b_id FROM reach r JOIN edges e ON e.a_id=r.node
 )
 SELECT r.node,min(r.root::text)::uuid FROM reach r GROUP BY r.node;
$$;
REVOKE ALL ON FUNCTION public.city_intelligence_4b_members(integer,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_systemic_issues(p_days_filter integer DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE config jsonb:=public.city_intelligence_4b_config(); result jsonb;
BEGIN
 IF NOT (public.is_operator() OR public.is_developer()) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 WITH facts AS MATERIALIZED (SELECT * FROM public.city_intelligence_facts(p_days_filter,p_category)),
 members AS MATERIALIZED (SELECT * FROM public.city_intelligence_4b_members(p_days_filter,p_category)),
 -- Read only factual historical independent verification times, never identities in output.
 verified_history AS MATERIALIZED (
  SELECT z.report_id,a.reviewed_at FROM public.resolution_reviews a JOIN public.report_resolutions z ON z.id=a.resolution_id
  JOIN facts f ON f.id=z.report_id
  WHERE a.decision='verify' AND a.verification_state='verified' AND z.submitted_by IS NOT NULL
   AND a.reviewer_user_id<>z.submitted_by AND a.reviewed_at>=f.created_at AND a.reviewed_at<=now()
 ), enriched AS (
  SELECT f.*,m.hotspot_id,r.organization_id,
   CASE WHEN f.status IN ('new','in_progress') THEN extract(epoch FROM (now()-greatest(f.created_at,
    (SELECT max(e.created_at) FROM public.report_events e WHERE e.report_id=f.id AND e.event_type='resolution_reopened'),
    (SELECT max(z.reopened_at) FROM public.report_resolutions z WHERE z.report_id=f.id))))/86400 END AS open_days,
   EXISTS(SELECT 1 FROM verified_history v JOIN members old ON old.report_id=v.report_id
    JOIN facts prev ON prev.id=v.report_id WHERE old.hotspot_id=m.hotspot_id AND v.report_id<>f.id
     AND f.created_at>v.reviewed_at
     AND 6371000*acos(least(1.0,greatest(-1.0,
      cos(radians(prev.latitude))*cos(radians(f.latitude))*cos(radians(f.longitude-prev.longitude))+
      sin(radians(prev.latitude))*sin(radians(f.latitude)))))<=(config->>'spatial_radius_meters')::numeric) AS after_verified
  FROM facts f JOIN members m ON m.report_id=f.id JOIN public.reports r ON r.id=f.id
 ), grouped AS (
  SELECT e.hotspot_id,e.category,avg(e.latitude) AS center_lat,avg(e.longitude) AS center_lng,
   count(*) AS report_count,sum(e.supports) AS support_count,
   count(*) FILTER(WHERE e.status IN ('new','in_progress')) AS active_count,
   count(*) FILTER(WHERE e.verified) AS verified_count,count(*) FILTER(WHERE e.reopened) AS reopened_count,
   min(e.created_at) AS first_observed,max(e.created_at) AS latest_observed,
   extract(epoch FROM (max(e.created_at)-min(e.created_at)))/86400 AS span_days,
   max(e.open_days) AS longest_open_days,
   count(*) FILTER(WHERE e.open_days>=(config->>'unresolved_days')::numeric) AS long_unresolved_count,
   count(*) FILTER(WHERE e.after_verified) AS post_resolution_count,
   CASE WHEN count(e.organization_id)=count(*) AND count(DISTINCT e.organization_id)=1
    THEN min(e.organization_id::text)::uuid END AS organization_id
  FROM enriched e GROUP BY e.hotspot_id,e.category
  HAVING count(*)>=(config->>'min_distinct_reports')::integer
 ), classified AS (
  SELECT g.*,o.name AS organization_name,
   jsonb_build_object('spatial_recurrence',true,
    'time_span',g.span_days>=(config->>'recurrence_span_days')::numeric,
    'reopened',g.reopened_count>0,'post_resolution_recurrence',g.post_resolution_count>0,
    'long_unresolved',g.long_unresolved_count>0) AS signals
  FROM grouped g LEFT JOIN public.organizations o ON o.id=g.organization_id
  WHERE g.span_days>=(config->>'recurrence_span_days')::numeric OR g.reopened_count>0
   OR g.post_resolution_count>0 OR g.long_unresolved_count>0
 )
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.category,c.hotspot_id),'[]'::jsonb) INTO result FROM classified c;
 RETURN jsonb_build_object('config',config,'issues',result);
END $$;

CREATE OR REPLACE FUNCTION public.get_service_performance(p_days_filter integer DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE config jsonb:=public.city_intelligence_4b_config(); result jsonb;
BEGIN
 IF NOT (public.is_operator() OR public.is_developer()) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 WITH facts AS MATERIALIZED (SELECT * FROM public.city_intelligence_facts(p_days_filter,p_category)),
 assigned AS MATERIALIZED (
  SELECT f.*,r.organization_id FROM facts f JOIN public.reports r ON r.id=f.id
 ), decisions AS (
  SELECT z.report_id,count(*) FILTER(WHERE a.decision='verify') AS verification_decisions,
   count(*) FILTER(WHERE a.decision='reopen') AS reopen_decisions
  FROM public.resolution_reviews a JOIN public.report_resolutions z ON z.id=a.resolution_id
  JOIN assigned f ON f.id=z.report_id
  WHERE a.reviewed_at<=now() AND a.reviewer_user_id<>z.submitted_by
  GROUP BY z.report_id
 ), grouped AS (
  SELECT o.id AS organization_id,o.name AS organization_name,count(*) AS assigned_count,
   count(*) FILTER(WHERE f.status IN ('new','in_progress')) AS active_count,
   count(*) FILTER(WHERE f.verified) AS verified_count,count(*) FILTER(WHERE f.reopened) AS reopened_count,
   coalesce(sum(d.verification_decisions),0) AS verification_decisions,coalesce(sum(d.reopen_decisions),0) AS reopen_decisions,
   count(f.resolution_hours) AS resolution_samples,
   CASE WHEN count(f.resolution_hours)>=(config->>'min_resolution_samples')::integer THEN avg(f.resolution_hours) END AS avg_resolution_hours,
   CASE WHEN count(f.resolution_hours)>=(config->>'min_resolution_samples')::integer
    THEN (percentile_cont(0.5) WITHIN GROUP(ORDER BY f.resolution_hours))::numeric END AS median_resolution_hours,
   round(100.0*count(*) FILTER(WHERE f.verified)/count(*),2) AS verified_share
  FROM assigned f JOIN public.organizations o ON o.id=f.organization_id LEFT JOIN decisions d ON d.report_id=f.id
  GROUP BY o.id,o.name
 )
 SELECT jsonb_build_object('config',config,'organizations',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.organization_name,g.organization_id) FROM grouped g),'[]'::jsonb),
  'unassigned_count',(SELECT count(*) FROM assigned f WHERE f.organization_id IS NULL),
  'total_reports',(SELECT count(*) FROM assigned)) INTO result;
 RETURN result;
END $$;

-- Bounded drilldown: already-public report ID/category/status/date only. No contacts or descriptions.
CREATE OR REPLACE FUNCTION public.get_intelligence_reports(p_days_filter integer DEFAULT NULL,p_category text DEFAULT NULL,
 p_hotspot_id uuid DEFAULT NULL,p_organization_id uuid DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (public.is_operator() OR public.is_developer()) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 IF (p_hotspot_id IS NULL)=(p_organization_id IS NULL) OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN
  RAISE EXCEPTION 'Choose one report scope and valid offset' USING ERRCODE='22023'; END IF;
 WITH facts AS MATERIALIZED (SELECT * FROM public.city_intelligence_facts(p_days_filter,p_category)),
 ids AS MATERIALIZED (SELECT m.report_id FROM public.city_intelligence_4b_members(p_days_filter,p_category) m WHERE p_hotspot_id IS NOT NULL AND m.hotspot_id=p_hotspot_id),
 matched AS MATERIALIZED (
  SELECT f.id,f.category,f.status,f.created_at FROM facts f JOIN public.reports r ON r.id=f.id
  WHERE (p_organization_id IS NOT NULL AND r.organization_id=p_organization_id)
   OR (p_hotspot_id IS NOT NULL AND f.id IN (SELECT i.report_id FROM ids i))
 ), page AS (SELECT * FROM matched m ORDER BY m.created_at DESC,m.id LIMIT 50 OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
  'reports',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_systemic_issues(integer,text),public.get_service_performance(integer,text),
 public.get_intelligence_reports(integer,text,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_systemic_issues(integer,text),public.get_service_performance(integer,text),
 public.get_intelligence_reports(integer,text,uuid,uuid,integer) TO authenticated;
COMMIT;
