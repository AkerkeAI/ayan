-- Phase 5D/5E. Apply AFTER 20260928122500_phase5bc_claims_and_insights.sql.
-- No backfill, no changes to existing reports or decisions. GPS coordinates are never stored.
BEGIN;
CREATE TABLE public.resolution_trust (
 resolution_id uuid PRIMARY KEY REFERENCES public.report_resolutions(id) ON DELETE CASCADE,
 organization_id uuid REFERENCES public.organizations(id),
 checked_at timestamptz,
 distance_m integer, accuracy_m integer, elapsed_seconds integer,
 photo_source text NOT NULL DEFAULT 'unknown' CHECK(photo_source IN ('camera','file','unknown')),
 flags text[] NOT NULL DEFAULT ARRAY['signals_missing'],
 after_sha256 text,
 ai_status text NOT NULL DEFAULT 'pending' CHECK(ai_status IN ('pending','available','unavailable'))
);
ALTER TABLE public.resolution_trust ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resolution_trust FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.resolution_trust TO authenticated;
CREATE POLICY staff_read_trust ON public.resolution_trust FOR SELECT TO authenticated
 USING(public.is_developer() OR organization_id=public.operator_organization_id());
-- Server attestation is not writable by operators, including through a direct RPC.
CREATE FUNCTION public.initialize_resolution_trust() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 INSERT INTO public.resolution_trust(resolution_id,organization_id,elapsed_seconds)
 SELECT NEW.id,c.organization_id,CASE WHEN c.claimed_at IS NULL THEN NULL
 ELSE greatest(0,extract(epoch FROM NEW.submitted_at-c.claimed_at))::integer END
 FROM public.report_claims c WHERE c.id=NEW.claim_id;
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_resolution_trust AFTER INSERT ON public.report_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.initialize_resolution_trust();
REVOKE ALL ON FUNCTION public.initialize_resolution_trust() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.record_resolution_trust(p_resolution_id uuid,p_signals jsonb,p_hash text,p_before_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE z public.report_resolutions; r public.reports; f text[]:=ARRAY[]::text[];
 lat double precision; lon double precision; accuracy double precision; sample_ms double precision;
 distance integer; source text; modified_ms double precision; uploaded timestamptz; seconds integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server required' USING ERRCODE='42501'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR (p_before_hash IS NOT NULL AND p_before_hash !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid hash'; END IF;
 SELECT * INTO z FROM public.report_resolutions WHERE id=p_resolution_id FOR UPDATE;
 IF NOT FOUND OR z.state NOT IN ('pending','ai_checked','needs_review') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.resolution_trust WHERE resolution_id=z.id AND checked_at IS NOT NULL) THEN RETURN; END IF;
 SELECT * INTO r FROM public.reports WHERE id=z.report_id;
 SELECT elapsed_seconds INTO seconds FROM public.resolution_trust WHERE resolution_id=z.id;
 IF seconds IS NULL THEN f:=array_append(f,'claim_time_unknown'); ELSIF seconds<60 THEN f:=array_append(f,'short_work_time'); END IF;
 source:=CASE WHEN p_signals->>'source' IN ('camera','file') THEN p_signals->>'source' ELSE 'unknown' END;
 IF source<>'camera' THEN f:=array_append(f,'camera_not_used'); END IF;
 -- Browser GPS/time/source are claims, never attestation. Discard exact location after calculating distance.
 BEGIN
  lat:=(p_signals->'gps'->>'latitude')::double precision;
  lon:=(p_signals->'gps'->>'longitude')::double precision;
  accuracy:=(p_signals->'gps'->>'accuracy')::double precision;
  sample_ms:=(p_signals->'gps'->>'timestamp')::double precision;
  IF lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND accuracy BETWEEN 0 AND 50000
    AND abs(extract(epoch FROM z.submitted_at)*1000-sample_ms)<=120000 THEN
   distance:=round(6371000*2*asin(sqrt(least(1.0,greatest(0.0,
    power(sin(radians(lat-r.latitude)/2),2)+cos(radians(lat))*cos(radians(r.latitude))*power(sin(radians(lon-r.longitude)/2),2))))))::integer;
   IF accuracy>100 THEN f:=array_append(f,'gps_imprecise'); END IF;
   IF distance>greatest(200,accuracy*2) THEN f:=array_append(f,'gps_far'); END IF;
  ELSE accuracy:=NULL; f:=array_append(f,'gps_missing_or_stale'); END IF;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  accuracy:=NULL; distance:=NULL; f:=array_append(f,'gps_missing_or_stale');
 END;
 BEGIN
  modified_ms:=(p_signals->>'photoTime')::double precision;
  IF modified_ms IS NULL OR abs(extract(epoch FROM z.submitted_at)*1000-modified_ms)>900000
    THEN f:=array_append(f,'photo_time_unknown_or_old'); END IF;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN f:=array_append(f,'photo_time_unknown_or_old'); END;
 SELECT created_at INTO uploaded FROM storage.objects WHERE bucket_id='resolution-images' AND name=z.after_photo_path;
 IF uploaded IS NULL OR uploaded<z.submitted_at-interval '15 minutes' THEN f:=array_append(f,'upload_not_fresh'); END IF;
 -- Serialise equality checks so simultaneous submissions of the same bytes are detected.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_hash,0));
 IF p_before_hash IS NULL THEN f:=array_append(f,'before_unavailable');
 ELSIF p_before_hash=p_hash THEN f:=array_append(f,'same_as_before'); END IF;
 IF EXISTS(SELECT 1 FROM public.resolution_trust WHERE after_sha256=p_hash AND resolution_id<>z.id)
 THEN f:=array_append(f,'photo_reused'); END IF;
 UPDATE public.resolution_trust SET checked_at=clock_timestamp(),distance_m=distance,accuracy_m=round(accuracy)::integer,
  photo_source=source,flags=f,after_sha256=p_hash WHERE resolution_id=z.id;
 -- Flags request attention; they NEVER reject, release a claim or verify a report.
END $$;
REVOKE ALL ON FUNCTION public.record_resolution_trust(uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_resolution_trust(uuid,jsonb,text,text) TO service_role;
CREATE INDEX resolution_trust_hash_idx ON public.resolution_trust(after_sha256) WHERE after_sha256 IS NOT NULL;

ALTER TABLE public.resolution_reviews ADD COLUMN reason text CHECK(reason IS NULL OR length(reason) BETWEEN 3 AND 1000);
CREATE FUNCTION public.review_report_resolution(p_resolution_id uuid,p_decision text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_report uuid; v_row public.report_resolutions; v_next text; v_time timestamptz := now();
BEGIN
  IF NOT public.is_developer() THEN RAISE EXCEPTION 'Developer required' USING ERRCODE='42501'; END IF;
  IF p_resolution_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('verify','reopen')
    THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
  IF p_decision='reopen' AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000) THEN RAISE EXCEPTION 'Rejection reason required' USING ERRCODE='22023'; END IF;
  SELECT report_id INTO v_report FROM public.report_resolutions WHERE id=p_resolution_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resolution not found' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.reports WHERE id=v_report FOR UPDATE;
  SELECT * INTO v_row FROM public.report_resolutions WHERE id=p_resolution_id FOR UPDATE;
  -- Even an operator later promoted to developer cannot review their own evidence.
  -- Unknown legacy author fails closed until an administrator establishes provenance.
  IF v_row.submitted_by IS NULL OR v_row.submitted_by=auth.uid()
    THEN RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE='42501'; END IF;
  IF v_row.state='reopened' OR (p_decision='verify' AND v_row.state='verified' AND v_row.reviewed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Review already completed' USING ERRCODE='22023'; END IF;
  v_next := CASE WHEN p_decision='verify' THEN 'verified' ELSE 'reopened' END;
  INSERT INTO public.resolution_reviews(resolution_id,reviewer_user_id,reviewed_at,decision,previous_state,verification_state,reason)
    VALUES(p_resolution_id,auth.uid(),v_time,p_decision,v_row.state,v_next,CASE WHEN p_decision='reopen' THEN btrim(p_reason) ELSE NULL END);
  UPDATE public.report_resolutions SET state=v_next,reviewed_at=v_time,
    verified_at=CASE WHEN p_decision='verify' THEN v_time ELSE verified_at END,
    reopened_at=CASE WHEN p_decision='reopen' THEN v_time ELSE reopened_at END WHERE id=p_resolution_id;
  UPDATE public.reports SET status=CASE WHEN p_decision='verify' THEN 'resolved' ELSE 'in_progress' END,
    resolved_at=CASE WHEN p_decision='verify' THEN v_time ELSE NULL END WHERE id=v_report;
  INSERT INTO public.report_events(report_id,event_type,title,actor_type,actor_user_id)
    VALUES(v_report,CASE WHEN p_decision='verify' THEN 'resolution_verified' ELSE 'resolution_reopened' END,
      CASE WHEN p_decision='verify' THEN 'Решение подтверждено независимым проверяющим' ELSE 'Повторно открыто' END,
      'developer',auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.review_report_resolution(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_report_resolution(uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.review_report_resolution(p_resolution_id uuid,p_decision text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN PERFORM public.review_report_resolution(p_resolution_id,p_decision,NULL); END $$;
-- Old verify callers remain compatible. Rejection must supply a reason through the 3-argument RPC.
CREATE OR REPLACE FUNCTION public.record_resolution_ai(p_resolution_id uuid, p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_report uuid; v_review boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server-only advisory' USING ERRCODE='42501'; END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result->'likely_resolved') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_result->'confidence') IS DISTINCT FROM 'number'
    OR (p_result->>'confidence')::numeric NOT BETWEEN 0 AND 1
    OR jsonb_typeof(p_result->'requires_human_review') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_result->'observations') IS DISTINCT FROM 'array'
    OR length(p_result::text)>6000 THEN RAISE EXCEPTION 'Invalid advisory'; END IF;
  v_review := (p_result->>'requires_human_review')::boolean
    OR NOT (p_result->>'likely_resolved')::boolean OR (p_result->>'confidence')::numeric < 0.8;
  v_review := v_review OR NOT EXISTS(SELECT 1 FROM public.resolution_trust WHERE resolution_id=p_resolution_id AND checked_at IS NOT NULL AND cardinality(flags)=0);
  UPDATE public.resolution_trust SET ai_status=CASE WHEN (p_result->>'confidence')::numeric=0 AND NOT (p_result->>'likely_resolved')::boolean THEN 'unavailable' ELSE 'available' END WHERE resolution_id=p_resolution_id;
  UPDATE public.report_resolutions SET ai_result=p_result,
    state=CASE WHEN v_review THEN 'needs_review' ELSE 'ai_checked' END
    WHERE id=p_resolution_id AND state='pending' RETURNING report_id INTO v_report;
  -- Late AI responses must never overwrite resident feedback or human decisions.
  IF v_report IS NOT NULL THEN
    INSERT INTO public.report_events(report_id,event_type,title,actor_type) VALUES
      (v_report,CASE WHEN v_review THEN 'resolution_review' ELSE 'resolution_check' END,
       CASE WHEN v_review THEN 'Требуется дополнительная проверка' ELSE 'Анализ фото завершён — требуется подтверждение человека' END,'ai');
  END IF;
END $$;


CREATE TABLE public.staff_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 organization_id uuid REFERENCES public.organizations(id),
 report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
 event_type text NOT NULL CHECK(event_type IN ('task_available','claimed_elsewhere','evidence_submitted','evidence_rejected','claim_released','resolution_verified','review_exception')),
 title text NOT NULL, body text,
 source_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), read_at timestamptz,
 UNIQUE(recipient_id,source_key)
);
CREATE INDEX staff_notifications_recipient_time ON public.staff_notifications(recipient_id,created_at DESC);
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.staff_notifications TO authenticated;
CREATE POLICY own_staff_notifications ON public.staff_notifications FOR SELECT TO authenticated
 USING(recipient_id=auth.uid() AND ((organization_id IS NULL AND public.is_developer())
 OR organization_id=public.operator_organization_id()));
CREATE FUNCTION public.set_notification_read(p_id uuid,p_read boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 UPDATE public.staff_notifications SET read_at=CASE WHEN p_read THEN clock_timestamp() ELSE NULL END
 WHERE id=p_id AND recipient_id=auth.uid() AND ((organization_id IS NULL AND public.is_developer()) OR organization_id=public.operator_organization_id());
 IF NOT FOUND THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_notification_read(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_notification_read(uuid,boolean) TO authenticated;

-- Internal helpers: not client-callable. Recipients come exclusively from enabled staff profiles.
CREATE FUNCTION public.notify_staff(p_report uuid,p_event text,p_source text,p_title text,p_body text,
 p_org uuid,p_developers boolean,p_eligible boolean,p_exclude uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_category text;
BEGIN
 SELECT CASE WHEN r.category='other' THEN coalesce((SELECT d.category_key FROM public.category_discoveries d
 WHERE d.report_id=r.id AND d.state IN ('matched','accepted')),'other') ELSE r.category END INTO v_category
 FROM public.reports r WHERE r.id=p_report;
 INSERT INTO public.staff_notifications(recipient_id,organization_id,report_id,event_type,title,body,source_key)
 SELECT p.id,CASE WHEN p.role='operator' THEN p.organization_id ELSE NULL END,p_report,p_event,p_title,p_body,p_source
 FROM public.operator_profiles p LEFT JOIN public.organizations o ON o.id=p.organization_id
 WHERE p.is_operator AND ((p_developers AND p.role='developer') OR
 (p.role='operator' AND o.active AND (p_exclude IS NULL OR o.id<>p_exclude)
 AND ((p_org IS NOT NULL AND o.id=p_org) OR (p_eligible AND o.category=v_category))))
 ON CONFLICT(recipient_id,source_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.notify_staff(uuid,text,text,text,text,uuid,boolean,boolean,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.notify_available_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE rid uuid; key text;
BEGIN
 IF TG_TABLE_NAME='reports' THEN rid:=NEW.id; key:=NEW.category;
 ELSE
  IF NEW.state NOT IN ('matched','accepted') THEN RETURN NEW; END IF;
  rid:=NEW.report_id; key:=NEW.category_key;
 END IF;
 IF EXISTS(SELECT 1 FROM public.reports WHERE id=rid AND organization_id IS NULL AND status IN ('new','in_progress')) THEN
  PERFORM public.notify_staff(rid,'task_available','available:'||rid||':'||key,'Новая задача доступна','Можно взять в работу.',NULL,false,true);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_available_task() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_available_task AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.notify_available_task();
CREATE TRIGGER notify_discovered_task AFTER INSERT OR UPDATE OF state,category_key ON public.category_discoveries
 FOR EACH ROW EXECUTE FUNCTION public.notify_available_task();

CREATE FUNCTION public.notify_claim_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM public.notify_staff(NEW.report_id,'claimed_elsewhere','claim:'||NEW.id,'Задачу уже взяла другая организация',NULL,NULL,false,true,NEW.organization_id);
 ELSIF NEW.released_at IS NOT NULL AND OLD.released_at IS NULL THEN
  PERFORM public.notify_staff(NEW.report_id,'claim_released','release:'||NEW.id,'Задача снова доступна','Предыдущее выполнение не подтверждено. Можно взять в работу.',NULL,true,true);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_claim_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_claim_change AFTER INSERT OR UPDATE OF released_at ON public.report_claims
 FOR EACH ROW EXECUTE FUNCTION public.notify_claim_change();

CREATE FUNCTION public.notify_resolution_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE org uuid; reason text;
BEGIN
 SELECT organization_id INTO org FROM public.report_claims WHERE id=NEW.claim_id;
 IF TG_OP='INSERT' THEN
  PERFORM public.notify_staff(NEW.report_id,'evidence_submitted','evidence:'||NEW.id,'Доказательства предоставлены','Требуется независимая проверка фото и сигналов доверия.',org,true,false);
 ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
  IF NEW.state='reopened' THEN
   SELECT a.reason INTO reason FROM public.resolution_reviews a WHERE a.resolution_id=NEW.id AND a.decision='reopen' ORDER BY a.reviewed_at DESC LIMIT 1;
   PERFORM public.notify_staff(NEW.report_id,'evidence_rejected','rejected:'||NEW.id,'Решение не подтверждено',coalesce(reason,'Житель сообщил, что проблема остаётся. Требуется проверка оператора Aýan.'),org,true,false);
  ELSIF NEW.state='verified' THEN
   PERFORM public.notify_staff(NEW.report_id,'resolution_verified','verified:'||NEW.id,'Решение подтверждено','Независимая проверка завершена.',org,true,false);
  ELSIF NEW.state='needs_review' THEN
   PERFORM public.notify_staff(NEW.report_id,'review_exception','exception:'||NEW.id,'Нужна дополнительная проверка','AI или сигналы доказательств требуют внимания.',NULL,true,false);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_resolution_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_resolution_change AFTER INSERT OR UPDATE OF state ON public.report_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.notify_resolution_change();
COMMIT;
