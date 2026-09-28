-- Phase 5A. Apply manually after 00014. No existing report/assignment rewrites.
BEGIN;
CREATE TABLE public.category_catalog (
 key text PRIMARY KEY, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 3 AND 60),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES auth.users(id)
);
-- Existing product metadata, not synthetic reports or analytics.
INSERT INTO public.category_catalog(key,name) VALUES ('roads','Дороги'),('lighting','Освещение'),('garbage','Мусор'),('water','Водоснабжение'),('manholes','Люки'),('sidewalks','Тротуары'),('infrastructure','Инфраструктура'),('other','Другое');
ALTER TABLE public.category_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.category_catalog FROM anon,authenticated;
GRANT SELECT ON public.category_catalog TO authenticated;
GRANT ALL ON public.category_catalog TO service_role;
CREATE POLICY developer_catalog ON public.category_catalog FOR SELECT TO authenticated USING(public.is_developer());
-- Permit administrators to associate an organization with a human-approved category.
-- Selection rules and existing assignments are unchanged.
ALTER TABLE public.organizations DROP CONSTRAINT organizations_category_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_category_catalog_fkey FOREIGN KEY(category) REFERENCES public.category_catalog(key);

CREATE OR REPLACE FUNCTION public.category_name_fingerprint(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
 SELECT string_agg(t.token,' ' ORDER BY t.token) FROM
 (SELECT DISTINCT left(x,5) AS token FROM regexp_split_to_table(replace(lower(btrim(p_name)),'ё','е'),'[^а-яa-z0-9]+') x WHERE x<>'') t;
$$;
REVOKE ALL ON FUNCTION public.category_name_fingerprint(text) FROM PUBLIC,anon,authenticated;
CREATE UNIQUE INDEX category_catalog_name_unique ON public.category_catalog(public.category_name_fingerprint(name));

CREATE TABLE public.category_discoveries (
 report_id uuid PRIMARY KEY REFERENCES public.reports(id), original_category text NOT NULL DEFAULT 'other' CHECK(original_category='other'),
 description text NOT NULL, photo_url text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 result jsonb, state text NOT NULL DEFAULT 'processing' CHECK(state IN ('processing','failed','low_confidence','matched','pending','accepted','rejected')),
 category_key text REFERENCES public.category_catalog(key), reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz,
 CHECK((state IN ('accepted','rejected'))=(reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
ALTER TABLE public.category_discoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.category_discoveries FROM anon,authenticated;
GRANT SELECT ON public.category_discoveries TO authenticated;
GRANT ALL ON public.category_discoveries TO service_role;
CREATE POLICY developer_discoveries ON public.category_discoveries FOR SELECT TO authenticated USING(public.is_developer());
CREATE INDEX category_discoveries_pending ON public.category_discoveries(created_at,report_id) WHERE state='pending';

CREATE OR REPLACE FUNCTION public.claim_category_discovery(p_report_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r public.reports; claimed uuid;
BEGIN
 SELECT * INTO r FROM public.reports WHERE id=p_report_id AND category='other' AND photo_url IS NOT NULL AND created_at >= now()-interval '5 minutes';
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.category_discoveries(report_id,description,photo_url) VALUES(r.id,r.description,r.photo_url)
 ON CONFLICT(report_id) DO NOTHING RETURNING report_id INTO claimed;
 IF claimed IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('description',r.description,'photo_url',r.photo_url);
END $$;
REVOKE ALL ON FUNCTION public.claim_category_discovery(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_category_discovery(uuid) TO service_role;

-- Private routing helper: original category stays other. Respect existing assignments
-- and the existing exactly-one-active-organization rule; no load balancing.
CREATE OR REPLACE FUNCTION public.route_discovered_category(p_report_id uuid,p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE assigned uuid; original text;
BEGIN
 SELECT r.organization_id,r.category INTO assigned,original FROM public.reports r WHERE r.id=p_report_id FOR UPDATE;
 IF NOT FOUND OR original<>'other' THEN RETURN assigned; END IF;
 UPDATE public.reports SET ai_category=p_key WHERE id=p_report_id;
 IF assigned IS NOT NULL THEN RETURN assigned; END IF;
 SELECT CASE WHEN count(*)=1 THEN min(o.id::text)::uuid END INTO assigned FROM public.organizations o WHERE o.active AND o.category=p_key;
 IF assigned IS NOT NULL THEN UPDATE public.reports SET organization_id=assigned WHERE id=p_report_id; END IF;
 RETURN assigned;
END $$;
REVOKE ALL ON FUNCTION public.route_discovered_category(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.finish_category_discovery(p_report_id uuid,p_result jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE d public.category_discoveries; v_key text; confidence numeric;
BEGIN
 PERFORM 1 FROM public.reports WHERE id=p_report_id FOR UPDATE;
 SELECT * INTO d FROM public.category_discoveries WHERE report_id=p_report_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'processing' THEN RETURN NULL; END IF;
 IF p_result IS NULL THEN UPDATE public.category_discoveries SET state='failed' WHERE report_id=p_report_id; RETURN NULL; END IF;
 IF jsonb_typeof(p_result->'matches_existing_category') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_result->'confidence') IS DISTINCT FROM 'number'
 OR jsonb_typeof(p_result->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid classification'; END IF;
 confidence:=(p_result->>'confidence')::numeric;
 IF confidence<0 OR confidence>1 OR length(p_result->>'reason') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid classification'; END IF;
 IF (p_result->>'matches_existing_category')::boolean THEN
  v_key:=p_result->>'existing_category';
  IF NOT EXISTS(SELECT 1 FROM public.category_catalog c WHERE c.key=v_key AND c.active AND c.key<>'other') OR p_result->>'suggested_new_category' IS NOT NULL THEN RAISE EXCEPTION 'Invalid existing category'; END IF;
 ELSE
  IF p_result->>'existing_category' IS NOT NULL OR coalesce(length(btrim(p_result->>'suggested_new_category')),0) NOT BETWEEN 3 AND 60 THEN RAISE EXCEPTION 'Invalid suggestion'; END IF;
 END IF;
 UPDATE public.category_discoveries SET result=p_result,state=CASE WHEN confidence<0.85 THEN 'low_confidence' WHEN v_key IS NOT NULL THEN 'matched' ELSE 'pending' END,category_key=CASE WHEN confidence>=0.85 THEN v_key END WHERE report_id=p_report_id;
 IF confidence>=0.85 AND v_key IS NOT NULL THEN RETURN public.route_discovered_category(p_report_id,v_key); END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.finish_category_discovery(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_category_discovery(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.review_category_suggestion(p_report_id uuid,p_decision text,p_name text DEFAULT NULL,p_existing_key text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE d public.category_discoveries; chosen text; label text;
BEGIN
 IF NOT public.is_developer() THEN RAISE EXCEPTION 'Developer required' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN ('accept','reject') OR p_decision IS NULL THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 -- Serialize catalogue decisions to prevent concurrent duplicate creations.
 PERFORM pg_advisory_xact_lock(515015);
 PERFORM 1 FROM public.reports WHERE id=p_report_id FOR UPDATE;
 SELECT * INTO d FROM public.category_discoveries WHERE report_id=p_report_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'pending' THEN RAISE EXCEPTION 'Suggestion already reviewed or unavailable' USING ERRCODE='22023'; END IF;
 IF p_decision='accept' THEN
  IF p_existing_key IS NOT NULL THEN
   SELECT c.key INTO chosen FROM public.category_catalog c WHERE c.key=p_existing_key AND c.key<>'other';
   IF chosen IS NULL THEN RAISE EXCEPTION 'Unknown category'; END IF;
  ELSE
   label:=btrim(coalesce(p_name,d.result->>'suggested_new_category'));
   IF length(label) NOT BETWEEN 3 AND 60 OR label !~ '[А-Яа-яЁё]' OR public.category_name_fingerprint(label) IS NULL THEN RAISE EXCEPTION 'Use a short Russian category name'; END IF;
   SELECT c.key INTO chosen FROM public.category_catalog c WHERE public.category_name_fingerprint(c.name)=public.category_name_fingerprint(label);
   IF chosen='other' THEN RAISE EXCEPTION 'Choose a specific category'; END IF;
   IF chosen IS NULL THEN
    chosen:='discovered_'||replace(gen_random_uuid()::text,'-','');
    INSERT INTO public.category_catalog(key,name,created_by) VALUES(chosen,label,auth.uid());
   END IF;
  END IF;
  UPDATE public.category_catalog SET active=true WHERE key=chosen;
  PERFORM public.route_discovered_category(p_report_id,chosen);
 END IF;
 UPDATE public.category_discoveries SET state=CASE WHEN p_decision='accept' THEN 'accepted' ELSE 'rejected' END,category_key=chosen,reviewed_by=auth.uid(),reviewed_at=now() WHERE report_id=p_report_id;
 RETURN chosen;
END $$;
REVOKE ALL ON FUNCTION public.review_category_suggestion(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_category_suggestion(uuid,text,text,text) TO authenticated;
COMMIT;
