-- Apply after 00013. Communication only; existing records and technical roles unchanged.
BEGIN;
DROP POLICY organization_messages_scoped ON public.organization_messages;
CREATE POLICY ayan_operator_messages ON public.organization_messages FOR ALL TO authenticated
 USING(public.is_developer())
 WITH CHECK(public.is_developer() AND EXISTS(SELECT 1 FROM public.reports r WHERE r.id=report_id AND r.organization_id=organization_messages.organization_id));
CREATE POLICY ayan_operator_read_organizations ON public.organizations FOR SELECT TO authenticated USING(public.is_developer());
CREATE OR REPLACE FUNCTION public.create_report_event(p_report_id uuid,p_event_type text,p_title text,
 p_description text DEFAULT NULL,p_actor_type text DEFAULT 'system',p_actor_user_id uuid DEFAULT NULL,p_organization_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE result uuid; assigned uuid;
BEGIN
 SELECT r.organization_id INTO assigned FROM public.reports r WHERE r.id=p_report_id FOR UPDATE;
 IF p_event_type IN ('message_prepared','message_sent','organization_replied') THEN
  IF NOT public.is_developer() THEN RAISE EXCEPTION 'Developer required for communication' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT public.can_operate_report(p_report_id) THEN RAISE EXCEPTION 'Organization access required' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_event_type NOT IN ('message_prepared','message_sent','organization_replied','status_changed')
  OR (p_organization_id IS NOT NULL AND p_organization_id<>assigned)
  OR (p_actor_user_id IS NOT NULL AND p_actor_user_id<>auth.uid()) THEN
  RAISE EXCEPTION 'Use the authorized workflow' USING ERRCODE='42501'; END IF;
 INSERT INTO public.report_events(report_id,event_type,title,description,actor_type,actor_user_id,organization_id)
 VALUES(p_report_id,p_event_type,p_title,p_description,CASE WHEN public.is_developer() THEN 'developer' ELSE 'operator' END,auth.uid(),assigned) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_report_event(uuid,text,text,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_report_event(uuid,text,text,text,text,uuid,uuid) TO authenticated;

COMMIT;
