-- Apply manually after 00012. No existing records or developer workflows changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.resolution_resident_feedback(p_resolution_id uuid,p_token uuid,p_decision text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_row public.report_resolutions; v_report uuid;
BEGIN
  IF p_token IS NULL OR p_decision IS NULL OR p_decision NOT IN ('confirm','reopen') THEN RAISE EXCEPTION 'Invalid feedback'; END IF;
  SELECT report_id INTO v_report FROM public.report_resolutions WHERE id=p_resolution_id;
  PERFORM 1 FROM public.reports WHERE id=v_report FOR UPDATE;
  SELECT * INTO v_row FROM public.report_resolutions WHERE id=p_resolution_id FOR UPDATE;
  IF NOT FOUND OR v_row.state='reopened' THEN RAISE EXCEPTION 'Feedback closed'; END IF;
  -- Checked after locking report and resolution: a concurrent developer verification wins.
  IF v_row.state='verified' THEN
    RAISE EXCEPTION 'Developer-verified resolution is closed to resident feedback' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.resolution_feedback(resolution_id,token_hash,decision)
    VALUES(p_resolution_id,encode(sha256(convert_to(p_token::text,'UTF8')),'hex'),p_decision);
  IF p_decision='reopen' THEN
    UPDATE public.report_resolutions SET state='reopened',reopened_at=now() WHERE id=p_resolution_id;
    UPDATE public.reports SET status='in_progress',resolved_at=NULL WHERE id=v_report;
  ELSE
    UPDATE public.report_resolutions SET state='resident_confirmed',resident_confirmed_at=now() WHERE id=p_resolution_id;
  END IF;
  INSERT INTO public.report_events(report_id,event_type,title,description,actor_type) VALUES
    (v_report,CASE WHEN p_decision='reopen' THEN 'resolution_reopened' ELSE 'resolution_resident_confirmed' END,
     CASE WHEN p_decision='reopen' THEN 'Повторно открыто' ELSE 'Житель сообщил об устранении проблемы' END,
     'Анонимный отзыв из браузера; личность не подтверждена.','resident');
END $$;

REVOKE ALL ON FUNCTION public.resolution_resident_feedback(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolution_resident_feedback(uuid,uuid,text) TO anon,authenticated;
COMMIT;
