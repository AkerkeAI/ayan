-- Apply manually AFTER 00011. Additive membership; no account/report backfill.
BEGIN;
ALTER TABLE public.operator_profiles ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
CREATE INDEX operator_profiles_organization_idx ON public.operator_profiles(organization_id);
-- Existing unlinked operators remain readable/login-capable but have no operational rights.
-- New/changed enabled profiles must be linked; validate after the administrator backfills.
ALTER TABLE public.operator_profiles ADD CONSTRAINT enabled_staff_organization
 CHECK (NOT is_operator OR (role='operator' AND organization_id IS NOT NULL) OR (role='developer' AND organization_id IS NULL)) NOT VALID;
REVOKE INSERT,UPDATE,DELETE ON public.operator_profiles FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.operator_organization_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT p.organization_id FROM public.operator_profiles p JOIN public.organizations o ON o.id=p.organization_id
 WHERE p.id=auth.uid() AND p.is_operator AND p.role='operator' AND o.active;
$$;
CREATE OR REPLACE FUNCTION public.can_operate_report(p_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.reports r WHERE r.id=p_report_id AND r.organization_id=public.operator_organization_id());
$$;
REVOKE ALL ON FUNCTION public.operator_organization_id(),public.can_operate_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.operator_organization_id(),public.can_operate_report(uuid) TO authenticated;

DROP POLICY operator_update_reports ON public.reports;
CREATE POLICY operator_update_reports ON public.reports FOR UPDATE TO authenticated
 USING (organization_id=public.operator_organization_id()) WITH CHECK (organization_id=public.operator_organization_id());
-- Keep resident public SELECT/INSERT. Operational queues use this server-scoped RPC.
CREATE OR REPLACE FUNCTION public.get_operational_reports()
RETURNS SETOF public.reports LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT (public.is_operator() OR public.is_developer()) THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.* FROM public.reports r WHERE public.is_developer() OR r.organization_id=public.operator_organization_id() ORDER BY r.created_at DESC,r.id;
END $$;
REVOKE ALL ON FUNCTION public.get_operational_reports() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_operational_reports() TO authenticated;

DROP POLICY operator_manage_organizations ON public.organizations;
CREATE POLICY operator_read_organization ON public.organizations FOR SELECT TO authenticated USING(id=public.operator_organization_id());
REVOKE INSERT,UPDATE,DELETE ON public.organizations FROM anon,authenticated;

DROP POLICY operator_manage_organization_messages ON public.organization_messages;
CREATE POLICY organization_messages_scoped ON public.organization_messages FOR ALL TO authenticated
 USING(organization_id=public.operator_organization_id() AND public.can_operate_report(report_id))
 WITH CHECK(organization_id=public.operator_organization_id() AND public.can_operate_report(report_id));
-- Both original message owner and current report owner must match. Reassignment never
-- transfers old private correspondence to another organization.

DROP POLICY operator_manage_report_events ON public.report_events;
REVOKE INSERT,UPDATE,DELETE ON public.report_events FROM anon,authenticated;
-- Public timelines remain factual. All new writes go through restricted RPCs/triggers.
DROP POLICY operator_manage_supports ON public.report_supports;
-- Resident +1 RPCs are unchanged. Operators have no direct access to supporter tokens.

DROP POLICY resolution_image_upload ON storage.objects;
CREATE POLICY resolution_image_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='resolution-images' AND (storage.foldername(name))[1]=auth.uid()::text
 AND CASE WHEN (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 THEN public.can_operate_report(((storage.foldername(name))[2])::uuid) ELSE false END);

-- Public creation cannot supply an organization, even with a crafted direct INSERT.
CREATE OR REPLACE FUNCTION public.guard_initial_organization()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND NEW.organization_id IS NOT NULL THEN
  RAISE EXCEPTION 'Assignment is server controlled' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_initial_organization() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_initial_organization BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.guard_initial_organization();

-- No arbitrary first company when more than one active company handles a category.
CREATE OR REPLACE FUNCTION public.get_responsible_organization(p_category text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT CASE WHEN count(*)=1 THEN min(o.id::text)::uuid END FROM public.organizations o WHERE o.category=p_category AND o.active;
$$;
REVOKE ALL ON FUNCTION public.get_responsible_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_responsible_organization(text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.assign_report_organization(p_report_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE report_category text; assigned uuid;
BEGIN
 SELECT r.category,r.organization_id INTO report_category,assigned FROM public.reports r WHERE r.id=p_report_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found' USING ERRCODE='P0002'; END IF;
 IF assigned IS NOT NULL THEN RETURN assigned; END IF; -- never rewrite real responsibility
 assigned:=public.get_responsible_organization(report_category);
 IF assigned IS NULL THEN RETURN NULL; END IF; -- unassigned; administrator must choose explicitly
 UPDATE public.reports SET organization_id=assigned WHERE id=p_report_id;
 RETURN assigned;
END $$;
REVOKE ALL ON FUNCTION public.assign_report_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_report_organization(uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.audit_report_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE previous_name text; next_name text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id THEN RETURN NEW; END IF;
  SELECT o.name INTO previous_name FROM public.organizations o WHERE o.id=OLD.organization_id;
 ELSIF NEW.organization_id IS NULL THEN RETURN NEW;
 END IF;
 SELECT o.name INTO next_name FROM public.organizations o WHERE o.id=NEW.organization_id;
 INSERT INTO public.report_events(report_id,event_type,title,description,actor_type,organization_id)
 VALUES(NEW.id,'routed','Ответственная организация изменена',coalesce(previous_name,'Не назначена')||' → '||coalesce(next_name,'Не назначена'),'system',NEW.organization_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_report_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_report_assignment AFTER INSERT OR UPDATE OF organization_id ON public.reports
 FOR EACH ROW EXECUTE FUNCTION public.audit_report_assignment();

CREATE OR REPLACE FUNCTION public.submit_report_resolution(p_report_id uuid, p_note text, p_photo_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_id uuid; v_status text;
BEGIN
  IF NOT public.is_operator() THEN RAISE EXCEPTION 'Operator required' USING ERRCODE='42501'; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Invalid note'; END IF;
  SELECT status INTO v_status FROM public.reports WHERE id=p_report_id FOR UPDATE;
  IF NOT public.can_operate_report(p_report_id) THEN RAISE EXCEPTION 'Organization access required' USING ERRCODE='42501'; END IF;
  IF NOT FOUND OR v_status NOT IN ('new','in_progress') THEN RAISE EXCEPTION 'Report is not active'; END IF;
  IF p_photo_path IS NULL OR p_photo_path NOT LIKE auth.uid()::text || '/' || p_report_id::text || '/%'
    OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='resolution-images' AND name=p_photo_path)
    THEN RAISE EXCEPTION 'Uploaded evidence required'; END IF;
  INSERT INTO public.report_resolutions(report_id,note,after_photo_path,submitted_by)
    VALUES(p_report_id,btrim(p_note),p_photo_path,auth.uid()) RETURNING id INTO v_id;
  UPDATE public.reports SET status='in_progress',resolved_at=NULL WHERE id=p_report_id;
  INSERT INTO public.report_events(report_id,event_type,title,actor_type,actor_user_id) VALUES
    (p_report_id,'resolution_submitted','Решение предоставлено','operator',auth.uid()),
    (p_report_id,'resolution_check','Проверка решения','system',NULL);
  RETURN v_id;
END $$;


CREATE OR REPLACE FUNCTION public.create_report_event(p_report_id uuid,p_event_type text,p_title text,
 p_description text DEFAULT NULL,p_actor_type text DEFAULT 'system',p_actor_user_id uuid DEFAULT NULL,p_organization_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE result uuid; assigned uuid;
BEGIN
 SELECT r.organization_id INTO assigned FROM public.reports r WHERE r.id=p_report_id FOR UPDATE;
 IF NOT public.can_operate_report(p_report_id) THEN RAISE EXCEPTION 'Organization access required' USING ERRCODE='42501'; END IF;
 IF p_event_type NOT IN ('message_prepared','message_sent','organization_replied','status_changed')
  OR (p_organization_id IS NOT NULL AND p_organization_id<>assigned)
  OR (p_actor_user_id IS NOT NULL AND p_actor_user_id<>auth.uid()) THEN
  RAISE EXCEPTION 'Use the authorized workflow' USING ERRCODE='42501'; END IF;
 INSERT INTO public.report_events(report_id,event_type,title,description,actor_type,actor_user_id,organization_id)
 VALUES(p_report_id,p_event_type,p_title,p_description,'operator',auth.uid(),assigned) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_report_event(uuid,text,text,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_report_event(uuid,text,text,text,text,uuid,uuid) TO authenticated;

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
  WHERE (public.is_developer() OR r.organization_id=public.operator_organization_id())
  AND ((p_organization_id IS NOT NULL AND r.organization_id=p_organization_id)
   OR (p_hotspot_id IS NOT NULL AND f.id IN (SELECT i.report_id FROM ids i)))
 ), page AS (SELECT * FROM matched m ORDER BY m.created_at DESC,m.id LIMIT 50 OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
  'reports',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;


COMMIT;
