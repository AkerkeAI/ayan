-- Next migration after 00015. Apply once; no report/organization reassignment backfill.
BEGIN;
ALTER TABLE public.reports ADD COLUMN claimed_at timestamptz;
CREATE TABLE public.report_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES public.reports(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), claimed_by uuid REFERENCES auth.users(id),
 claimed_at timestamptz, legacy_assignment boolean NOT NULL DEFAULT false,
 released_at timestamptz, released_by uuid REFERENCES auth.users(id),
 CHECK (legacy_assignment OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE UNIQUE INDEX report_one_active_claim ON public.report_claims(report_id) WHERE released_at IS NULL;
CREATE INDEX report_claim_organization ON public.report_claims(organization_id,report_id);
ALTER TABLE public.report_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_claims FROM anon,authenticated;
GRANT SELECT ON public.report_claims TO authenticated;
GRANT ALL ON public.report_claims TO service_role;
CREATE POLICY read_own_claims ON public.report_claims FOR SELECT TO authenticated
 USING(public.is_developer() OR organization_id=public.operator_organization_id());
-- Preserve previous assignments without inventing claimant identities or claim dates.
INSERT INTO public.report_claims(report_id,organization_id,legacy_assignment)
 SELECT id,organization_id,true FROM public.reports WHERE organization_id IS NOT NULL;
ALTER TABLE public.report_resolutions ADD COLUMN claim_id uuid REFERENCES public.report_claims(id);
-- Current legacy evidence remains with its pre-migration assignment; old reopened attempts
-- with unknown historical responsibility are not guessed/backfilled.
UPDATE public.report_resolutions z SET claim_id=c.id FROM public.report_claims c
 WHERE z.report_id=c.report_id AND z.state<>'reopened' AND c.legacy_assignment;

CREATE OR REPLACE FUNCTION public.can_operate_report(p_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.reports r JOIN public.report_claims c ON c.report_id=r.id
 WHERE r.id=p_report_id AND r.status IN ('new','in_progress') AND c.released_at IS NULL
 AND r.organization_id=c.organization_id AND c.organization_id=public.operator_organization_id());
$$;
CREATE FUNCTION public.can_claim_report(p_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.reports r JOIN public.organizations o ON o.id=public.operator_organization_id()
 WHERE r.id=p_report_id AND r.status IN ('new','in_progress') AND r.organization_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.report_claims c WHERE c.report_id=r.id AND c.released_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.report_resolutions z WHERE z.report_id=r.id AND z.state<>'reopened')
 AND o.active AND o.category=CASE WHEN r.category='other' THEN coalesce(
 (SELECT d.category_key FROM public.category_discoveries d WHERE d.report_id=r.id AND d.state IN ('matched','accepted')),'other') ELSE r.category END);
$$;
REVOKE ALL ON FUNCTION public.can_claim_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_claim_report(uuid) TO authenticated;
DROP POLICY operator_update_reports ON public.reports;
CREATE POLICY operator_update_reports ON public.reports FOR UPDATE TO authenticated
 USING(public.can_operate_report(id)) WITH CHECK(organization_id=public.operator_organization_id());
CREATE OR REPLACE FUNCTION public.guard_initial_organization()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (NEW.organization_id IS NOT NULL OR NEW.claimed_at IS NOT NULL) THEN
 RAISE EXCEPTION 'Claim is server controlled' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.get_operational_reports()
RETURNS SETOF public.reports LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT (public.is_operator() OR public.is_developer()) THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.* FROM public.reports r WHERE public.is_developer()
 OR r.organization_id=public.operator_organization_id() OR public.can_claim_report(r.id) ORDER BY r.created_at DESC,r.id;
END $$;
-- Legacy routing entry points may report an existing owner, but must never auto-assign.
CREATE OR REPLACE FUNCTION public.assign_report_organization(p_report_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE assigned uuid;
BEGIN
 SELECT organization_id INTO assigned FROM public.reports WHERE id=p_report_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found' USING ERRCODE='P0002'; END IF;
 RETURN assigned;
END $$;
CREATE OR REPLACE FUNCTION public.route_discovered_category(p_report_id uuid,p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE assigned uuid;
BEGIN
 UPDATE public.reports SET ai_category=p_key WHERE id=p_report_id AND category='other' RETURNING organization_id INTO assigned;
 RETURN assigned;
END $$;
ALTER TABLE public.report_events DROP CONSTRAINT report_events_event_type_check;
ALTER TABLE public.report_events ADD CONSTRAINT report_events_event_type_check CHECK(event_type IN (
 'report_created','routed','message_prepared','message_sent','organization_replied','status_changed',
 'resolution_submitted','resolution_check','resolution_review','resolution_resident_confirmed','resolution_verified','resolution_reopened',
 'organization_claimed','organization_released'));
CREATE FUNCTION public.claim_report(p_report_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE org uuid; r public.reports; existing public.report_claims; stamp timestamptz;
BEGIN
 org:=public.operator_organization_id();
 IF org IS NULL THEN RAISE EXCEPTION 'Active organization operator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.reports WHERE id=p_report_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found' USING ERRCODE='P0002'; END IF;
 IF r.status='resolved' THEN RAISE EXCEPTION 'Report closed' USING ERRCODE='22023'; END IF;
 SELECT * INTO existing FROM public.report_claims WHERE report_id=p_report_id AND released_at IS NULL;
 IF FOUND THEN
  IF existing.organization_id=org THEN RETURN org; END IF;
  RAISE EXCEPTION 'Task already claimed' USING ERRCODE='40001';
 END IF;
 IF NOT public.can_claim_report(p_report_id) THEN RAISE EXCEPTION 'Report not eligible' USING ERRCODE='42501'; END IF;
 stamp:=clock_timestamp();
 INSERT INTO public.report_claims(report_id,organization_id,claimed_by,claimed_at) VALUES(p_report_id,org,auth.uid(),stamp);
 UPDATE public.reports SET organization_id=org,claimed_at=stamp,status='in_progress' WHERE id=p_report_id;
 INSERT INTO public.report_events(report_id,event_type,title,actor_type,actor_user_id,organization_id)
 VALUES(p_report_id,'organization_claimed','Организация взяла задачу в работу','operator',auth.uid(),org);
 RETURN org;
END $$;
REVOKE ALL ON FUNCTION public.claim_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_report(uuid) TO authenticated;
CREATE FUNCTION public.report_claim_access(p_report_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE org uuid:=public.operator_organization_id(); r public.reports;
BEGIN
 IF org IS NULL THEN RAISE EXCEPTION 'Operator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.reports WHERE id=p_report_id;
 RETURN jsonb_build_object('can_claim',public.can_claim_report(p_report_id),'can_operate',public.can_operate_report(p_report_id),
 'claimed_elsewhere',coalesce(r.organization_id<>org,false),'claimed_at',r.claimed_at,'legacy_assignment',r.organization_id=org AND r.claimed_at IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.report_claim_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.report_claim_access(uuid) TO authenticated;

CREATE FUNCTION public.bind_resolution_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public.reports WHERE id=NEW.report_id FOR UPDATE;
 IF NOT public.can_operate_report(NEW.report_id) THEN RAISE EXCEPTION 'Claim required' USING ERRCODE='42501'; END IF;
 SELECT c.id INTO NEW.claim_id FROM public.report_claims c WHERE c.report_id=NEW.report_id AND c.released_at IS NULL AND c.organization_id=public.operator_organization_id();
 IF NEW.claim_id IS NULL THEN RAISE EXCEPTION 'Claim required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bind_resolution_claim() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bind_resolution_claim BEFORE INSERT ON public.report_resolutions FOR EACH ROW EXECUTE FUNCTION public.bind_resolution_claim();
CREATE FUNCTION public.guard_verified_final()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF OLD.state='verified' AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'Verified resolution is final' USING ERRCODE='42501'; END IF;
 IF NEW.claim_id IS DISTINCT FROM OLD.claim_id THEN RAISE EXCEPTION 'Evidence attribution is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_verified_final() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_verified_final BEFORE UPDATE ON public.report_resolutions FOR EACH ROW EXECUTE FUNCTION public.guard_verified_final();
CREATE FUNCTION public.release_rejected_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE released public.report_claims;
BEGIN
 IF NEW.state='reopened' AND OLD.state<>'reopened' THEN
  PERFORM 1 FROM public.reports WHERE id=NEW.report_id FOR UPDATE;
  UPDATE public.report_claims SET released_at=clock_timestamp(),released_by=auth.uid()
   WHERE id=NEW.claim_id AND released_at IS NULL RETURNING * INTO released;
  IF FOUND THEN
   UPDATE public.reports SET organization_id=NULL,claimed_at=NULL WHERE id=NEW.report_id AND organization_id=released.organization_id;
   INSERT INTO public.report_events(report_id,event_type,title,actor_type,actor_user_id,organization_id)
   VALUES(NEW.report_id,'organization_released','Задача снова доступна организациям','system',auth.uid(),released.organization_id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_rejected_claim() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER release_rejected_claim AFTER UPDATE OF state ON public.report_resolutions FOR EACH ROW EXECUTE FUNCTION public.release_rejected_claim();
-- Publish only already-public report rows for immediate claim UI invalidation.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(
 SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='reports') THEN
 ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;
 END IF;
END $$;

-- Attribute work and decisions to immutable claim/evidence history, not the current owner.
CREATE OR REPLACE FUNCTION public.get_service_performance(p_days_filter integer DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE config jsonb:=public.city_intelligence_4b_config(); result jsonb;
BEGIN
 IF NOT (public.is_operator() OR public.is_developer()) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 WITH facts AS MATERIALIZED (SELECT * FROM public.city_intelligence_facts(p_days_filter,p_category)),
 owners AS (SELECT DISTINCT report_id,organization_id FROM public.report_claims),
 cases AS (
 SELECT f.*,o.organization_id,
 EXISTS(SELECT 1 FROM public.report_claims c WHERE c.report_id=f.id AND c.organization_id=o.organization_id AND c.released_at IS NULL) AS current_owner,
 v.hours AS work_hours,v.verified AS work_verified,
 EXISTS(SELECT 1 FROM public.report_resolutions z JOIN public.report_claims c ON c.id=z.claim_id WHERE z.report_id=f.id AND c.organization_id=o.organization_id AND z.state='reopened') AS work_reopened
 FROM facts f JOIN owners o ON o.report_id=f.id LEFT JOIN LATERAL (
 SELECT true AS verified,extract(epoch FROM(z.verified_at-coalesce(c.claimed_at,f.created_at)))/3600 AS hours
 FROM public.report_resolutions z JOIN public.report_claims c ON c.id=z.claim_id
 WHERE z.report_id=f.id AND c.organization_id=o.organization_id AND z.state='verified' AND f.verified
 ORDER BY z.verified_at DESC LIMIT 1) v ON true
 ), decisions AS (
 SELECT z.report_id,c.organization_id,count(*) FILTER(WHERE a.decision='verify') AS verification_decisions,
 count(*) FILTER(WHERE a.decision='reopen') AS reopen_decisions
 FROM public.resolution_reviews a JOIN public.report_resolutions z ON z.id=a.resolution_id JOIN public.report_claims c ON c.id=z.claim_id
 WHERE a.reviewed_at<=now() AND a.reviewer_user_id<>z.submitted_by GROUP BY z.report_id,c.organization_id
 ), grouped AS (
 SELECT o.id AS organization_id,o.name AS organization_name,count(*) AS assigned_count,
 count(*) FILTER(WHERE f.current_owner AND f.status IN ('new','in_progress')) AS active_count,
 count(*) FILTER(WHERE f.work_verified) AS verified_count,count(*) FILTER(WHERE f.work_reopened) AS reopened_count,
 coalesce(sum(d.verification_decisions),0) AS verification_decisions,coalesce(sum(d.reopen_decisions),0) AS reopen_decisions,
 count(f.work_hours) AS resolution_samples,
 CASE WHEN count(f.work_hours)>=(config->>'min_resolution_samples')::int THEN avg(f.work_hours) END AS avg_resolution_hours,
 CASE WHEN count(f.work_hours)>=(config->>'min_resolution_samples')::int THEN (percentile_cont(0.5) WITHIN GROUP(ORDER BY f.work_hours))::numeric END AS median_resolution_hours,
 round(100.0*count(*) FILTER(WHERE f.work_verified)/count(*),2) AS verified_share
 FROM cases f JOIN public.organizations o ON o.id=f.organization_id LEFT JOIN decisions d ON d.report_id=f.id AND d.organization_id=f.organization_id GROUP BY o.id,o.name
 )
 SELECT jsonb_build_object('config',config,'organizations',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.organization_name,g.organization_id) FROM grouped g),'[]'::jsonb),
 'unassigned_count',(SELECT count(*) FROM facts f WHERE NOT EXISTS(SELECT 1 FROM public.report_claims c WHERE c.report_id=f.id AND c.released_at IS NULL)),
 'total_reports',(SELECT count(*) FROM facts)) INTO result;
 RETURN result;
END $$;
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
  WHERE (public.is_developer() OR EXISTS(SELECT 1 FROM public.report_claims c WHERE c.report_id=f.id AND c.organization_id=public.operator_organization_id()))
  AND ((p_organization_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.report_claims c WHERE c.report_id=f.id AND c.organization_id=p_organization_id))
   OR (p_hotspot_id IS NOT NULL AND f.id IN (SELECT i.report_id FROM ids i)))
 ), page AS (SELECT * FROM matched m ORDER BY m.created_at DESC,m.id LIMIT 50 OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
  'reports',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;



COMMIT;
