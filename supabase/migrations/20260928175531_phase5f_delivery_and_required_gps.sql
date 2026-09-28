-- Apply AFTER Phase 5D/5E. No backfill or changes to existing evidence/decisions.
BEGIN;
-- Internal diagnostics are not public or executor-readable, even via direct REST.
DROP POLICY staff_read_trust ON public.resolution_trust;
CREATE POLICY reviewer_read_trust ON public.resolution_trust FOR SELECT TO authenticated USING(public.is_developer());
REVOKE SELECT ON public.report_resolutions FROM anon,authenticated;
GRANT SELECT(id,report_id,note,after_photo_path,submitted_at,state,resident_confirmed_at,verified_at,reopened_at,submitted_by,reviewed_at,claim_id) ON public.report_resolutions TO anon,authenticated;
CREATE FUNCTION public.developer_resolution_rows() RETURNS SETOF public.report_resolutions
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT public.is_developer() THEN RAISE EXCEPTION 'Reviewer required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM public.report_resolutions;
END $$;
REVOKE ALL ON FUNCTION public.developer_resolution_rows() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.developer_resolution_rows() TO authenticated;

CREATE FUNCTION public.require_fresh_evidence_gps(p_signals jsonb) RETURNS void
 LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $$
DECLARE lat double precision; lon double precision; acc double precision; ts double precision;
BEGIN
 IF jsonb_typeof(p_signals->'gps'->'latitude') IS DISTINCT FROM 'number' OR
 jsonb_typeof(p_signals->'gps'->'longitude') IS DISTINCT FROM 'number' OR
 jsonb_typeof(p_signals->'gps'->'accuracy') IS DISTINCT FROM 'number' OR
 jsonb_typeof(p_signals->'gps'->'timestamp') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Fresh GPS required' USING ERRCODE='22023'; END IF;
 lat:=(p_signals->'gps'->>'latitude')::double precision;lon:=(p_signals->'gps'->>'longitude')::double precision;
 acc:=(p_signals->'gps'->>'accuracy')::double precision;ts:=(p_signals->'gps'->>'timestamp')::double precision;
 IF NOT(lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND acc BETWEEN 0 AND 10000000
 AND ts BETWEEN extract(epoch FROM statement_timestamp())*1000-120000 AND extract(epoch FROM statement_timestamp())*1000+30000)
 THEN RAISE EXCEPTION 'Fresh GPS required' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_fresh_evidence_gps(jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.submit_report_resolution(p_report_id uuid, p_note text, p_photo_path text,p_signals jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_id uuid; v_status text; v_distance integer; v_accuracy integer;
BEGIN
  IF NOT public.is_operator() THEN RAISE EXCEPTION 'Operator required' USING ERRCODE='42501'; END IF;
  PERFORM public.require_fresh_evidence_gps(p_signals);
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
  SELECT round(6371000*2*asin(sqrt(least(1.0,greatest(0.0,
   power(sin(radians((p_signals->'gps'->>'latitude')::double precision-r.latitude)/2),2)+
   cos(radians((p_signals->'gps'->>'latitude')::double precision))*cos(radians(r.latitude))*
   power(sin(radians((p_signals->'gps'->>'longitude')::double precision-r.longitude)/2),2))))))::integer
   INTO v_distance FROM public.reports r WHERE r.id=p_report_id;
  v_accuracy:=round((p_signals->'gps'->>'accuracy')::double precision)::integer;
  UPDATE public.resolution_trust SET distance_m=v_distance,accuracy_m=v_accuracy,
   flags=ARRAY['photo_checks_missing'] || CASE WHEN v_accuracy>100 THEN ARRAY['gps_imprecise'] ELSE ARRAY[]::text[] END ||
    CASE WHEN v_distance>greatest(200,v_accuracy*2) THEN ARRAY['gps_far'] ELSE ARRAY[]::text[] END
   WHERE resolution_id=v_id;
  -- Exact coordinates are used only in this transaction, never persisted.
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_report_resolution(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_report_resolution(uuid,text,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.submit_report_resolution(p_report_id uuid,p_note text,p_photo_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Fresh GPS required; use the current submission form' USING ERRCODE='22023'; END $$;

CREATE TABLE public.external_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),report_id uuid NOT NULL REFERENCES public.reports(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),source_key text NOT NULL,event_type text NOT NULL,
 channel text NOT NULL,destination text NOT NULL,category_name text NOT NULL,address text NOT NULL,description text NOT NULL,reason text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','retry','blocked','uncertain','sent','cancelled')),
 attempts integer NOT NULL DEFAULT 0,first_attempt_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,lease_token uuid,request_payload jsonb,provider_id text,last_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,
 UNIQUE(organization_id,source_key),CHECK(status<>'sent' OR (provider_id IS NOT NULL AND sent_at IS NOT NULL))
);
CREATE INDEX external_notifications_due ON public.external_notifications(next_attempt_at) WHERE status IN ('pending','retry','processing');
ALTER TABLE public.external_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.external_notifications TO authenticated;
CREATE POLICY reviewer_external_notifications ON public.external_notifications FOR SELECT TO authenticated USING(public.is_developer());
-- Only internal fanout and service-only fenced RPCs can change delivery state.
ALTER TABLE public.staff_notifications DROP CONSTRAINT staff_notifications_event_type_check;
ALTER TABLE public.staff_notifications ADD CONSTRAINT staff_notifications_event_type_check CHECK(event_type IN ('task_available','claimed_elsewhere','evidence_submitted','evidence_rejected','claim_released','resolution_verified','review_exception','delivery_exception'));
CREATE FUNCTION public.external_delivery_exception() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NEW.status IN ('blocked','uncertain','retry') THEN
  INSERT INTO public.staff_notifications(recipient_id,report_id,event_type,title,body,source_key)
  SELECT p.id,NEW.report_id,'delivery_exception','Внешнее уведомление требует внимания',
   'Статус: '||NEW.status||'. Код: '||coalesce(NEW.last_code,'UNKNOWN')||'. Подробности в центре уведомлений.',
   'delivery:'||NEW.id||':'||coalesce(NEW.last_code,'UNKNOWN')
  FROM public.operator_profiles p WHERE p.is_operator AND p.role='developer'
  ON CONFLICT(recipient_id,source_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.external_delivery_exception() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER external_delivery_exception AFTER INSERT OR UPDATE OF status ON public.external_notifications
 FOR EACH ROW EXECUTE FUNCTION public.external_delivery_exception();
CREATE OR REPLACE FUNCTION public.notify_staff(p_report uuid,p_event text,p_source text,p_title text,p_body text,
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
 IF p_event IN ('task_available','claim_released') THEN
  UPDATE public.external_notifications SET status='cancelled',last_code='SUPERSEDED',lease_token=NULL,lease_until=NULL
  WHERE report_id=p_report AND source_key<>p_source AND event_type IN ('task_available','claim_released')
    AND first_attempt_at IS NULL AND status IN ('pending','retry','blocked','processing');
 END IF;
 IF p_event IN ('task_available','claimed_elsewhere','evidence_rejected','claim_released','resolution_verified') THEN
  INSERT INTO public.external_notifications(report_id,organization_id,source_key,event_type,channel,destination,category_name,address,description,reason,status,last_code)
  SELECT r.id,o.id,p_source,p_event,o.channel,o.destination,coalesce(c.name,v_category),r.address,left(r.description,600),
   CASE WHEN p_event='evidence_rejected' THEN left(p_body,1000) ELSE NULL END,
   CASE WHEN o.channel='email' THEN 'pending' ELSE 'blocked' END,
   CASE WHEN o.channel='email' THEN NULL ELSE 'UNSUPPORTED_CHANNEL' END
  FROM public.organizations o CROSS JOIN public.reports r LEFT JOIN public.category_catalog c ON c.key=v_category
  WHERE r.id=p_report AND o.active AND (p_exclude IS NULL OR o.id<>p_exclude)
   AND ((p_org IS NOT NULL AND o.id=p_org) OR (p_eligible AND o.category=v_category))
  ON CONFLICT(organization_id,source_key) DO NOTHING;
 END IF;
END $$;
CREATE FUNCTION public.claim_external_notification() RETURNS SETOF public.external_notifications
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.external_notifications; current_org public.organizations; scan integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server required' USING ERRCODE='42501'; END IF;
 -- Resend deduplication is 24h; stop before the window ends, including after crashed workers.
 UPDATE public.external_notifications SET status='uncertain',last_code='RECONCILE_REQUIRED',lease_token=NULL,lease_until=NULL
 WHERE status IN ('pending','retry','processing') AND (first_attempt_at<clock_timestamp()-interval '23 hours' OR attempts>=6)
 AND (status<>'processing' OR lease_until<clock_timestamp());
 UPDATE public.external_notifications SET status='retry',last_code='WORKER_INTERRUPTED',lease_token=NULL,lease_until=NULL
 WHERE status='processing' AND lease_until<clock_timestamp();
 FOR scan IN 1..30 LOOP
  SELECT * INTO job FROM public.external_notifications WHERE status IN ('pending','retry') AND next_attempt_at<=clock_timestamp()
   ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO current_org FROM public.organizations WHERE id=job.organization_id;
  IF NOT current_org.active THEN
   UPDATE public.external_notifications SET status='blocked',last_code='ORGANIZATION_INACTIVE' WHERE id=job.id;CONTINUE;
  END IF;
  IF current_org.channel<>job.channel OR current_org.destination<>job.destination THEN
   UPDATE public.external_notifications SET status='blocked',last_code='CONTACT_CHANGED' WHERE id=job.id;CONTINUE;
  END IF;
  IF job.first_attempt_at IS NULL AND job.event_type IN ('task_available','claim_released') AND NOT EXISTS(
   SELECT 1 FROM public.reports r WHERE r.id=job.report_id AND r.organization_id IS NULL AND r.status IN ('new','in_progress')
   AND current_org.category=CASE WHEN r.category='other' THEN coalesce((SELECT d.category_key FROM public.category_discoveries d WHERE d.report_id=r.id AND d.state IN ('matched','accepted')),'other') ELSE r.category END)
  THEN UPDATE public.external_notifications SET status='cancelled',last_code='TASK_NO_LONGER_AVAILABLE' WHERE id=job.id;CONTINUE; END IF;
  UPDATE public.external_notifications SET status='processing',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
  WHERE id=job.id RETURNING * INTO job;
  RETURN NEXT job;RETURN;
 END LOOP;
END $$;
CREATE FUNCTION public.begin_external_attempt(p_id uuid,p_lease uuid,p_payload jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.external_notifications;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server required' USING ERRCODE='42501'; END IF;
 SELECT * INTO job FROM public.external_notifications WHERE id=p_id AND status='processing' AND lease_token=p_lease AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR job.attempts>=6 OR job.first_attempt_at<clock_timestamp()-interval '23 hours' THEN RAISE EXCEPTION 'Lease or retry window expired' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>12000 OR
 (job.request_payload IS NOT NULL AND job.request_payload<>p_payload) THEN RAISE EXCEPTION 'Immutable payload required'; END IF;
 UPDATE public.external_notifications SET request_payload=p_payload,attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()) WHERE id=p_id;
END $$;
CREATE FUNCTION public.finish_external_notification(p_id uuid,p_lease uuid,p_status text,p_code text,p_provider_id text DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.external_notifications;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server required' USING ERRCODE='42501'; END IF;
 SELECT * INTO job FROM public.external_notifications WHERE id=p_id AND status='processing' AND lease_token=p_lease AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease expired' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('sent','retry','blocked') OR p_code IS NULL OR p_code !~ '^[A-Z0-9_]{1,60}$' THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
 IF p_status='sent' AND (p_provider_id IS NULL OR p_provider_id !~ '^[a-f0-9-]{36}$' OR job.first_attempt_at IS NULL) THEN RAISE EXCEPTION 'Provider confirmation required'; END IF;
 UPDATE public.external_notifications SET status=CASE WHEN p_status='retry' AND attempts>=6 THEN 'uncertain' ELSE p_status END,
 last_code=p_code,provider_id=CASE WHEN p_status='sent' THEN p_provider_id ELSE provider_id END,
 sent_at=CASE WHEN p_status='sent' THEN clock_timestamp() ELSE NULL END,
 next_attempt_at=clock_timestamp()+make_interval(secs=>least(1800,60*power(2,attempts)::integer)),lease_token=NULL,lease_until=NULL
 WHERE id=p_id;
END $$;
CREATE FUNCTION public.retry_external_notification(p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.external_notifications; org public.organizations;
BEGIN
 IF NOT public.is_developer() THEN RAISE EXCEPTION 'Reviewer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO job FROM public.external_notifications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.status<>'blocked' OR job.attempts>=6 OR job.first_attempt_at<clock_timestamp()-interval '23 hours'
 THEN RAISE EXCEPTION 'Automatic retry unsafe or unavailable' USING ERRCODE='22023'; END IF;
 SELECT * INTO org FROM public.organizations WHERE id=job.organization_id;
 IF NOT org.active OR org.channel<>'email' OR (job.first_attempt_at IS NOT NULL AND (org.channel<>job.channel OR org.destination<>job.destination)) THEN RAISE EXCEPTION 'Configuration unavailable or reconciliation required' USING ERRCODE='22023'; END IF;
 UPDATE public.external_notifications SET status='pending',channel=org.channel,destination=org.destination,last_code=NULL,next_attempt_at=clock_timestamp() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_external_notification(), public.begin_external_attempt(uuid,uuid,jsonb),public.finish_external_notification(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_external_notification(),public.begin_external_attempt(uuid,uuid,jsonb),public.finish_external_notification(uuid,uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.retry_external_notification(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.retry_external_notification(uuid) TO authenticated;
-- Legacy draft API must not be a way to fabricate provider delivery.
CREATE FUNCTION public.guard_manual_message_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF current_user='authenticated' AND (NEW.status<>'draft' OR NEW.sent_at IS NOT NULL OR NEW.provider_message_id IS NOT NULL
 OR (TG_OP='UPDATE' AND OLD.status<>'draft')) THEN RAISE EXCEPTION 'Provider confirmation required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_manual_message_delivery() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_manual_message_delivery BEFORE INSERT OR UPDATE ON public.organization_messages FOR EACH ROW EXECUTE FUNCTION public.guard_manual_message_delivery();
CREATE OR REPLACE FUNCTION public.record_resolution_trust(p_resolution_id uuid,p_signals jsonb,p_hash text,p_before_hash text)
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
  IF lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND accuracy BETWEEN 0 AND 10000000
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
COMMIT;
