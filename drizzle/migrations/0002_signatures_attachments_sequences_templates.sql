ALTER TABLE public.sending_accounts ADD COLUMN signature text NOT NULL DEFAULT '';

ALTER TABLE public.campaigns
  ADD COLUMN follow_ups jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN behavior jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.campaign_leads DROP CONSTRAINT IF EXISTS campaign_leads_current_step_check;
ALTER TABLE public.campaign_leads ADD CONSTRAINT campaign_leads_current_step_check CHECK (current_step BETWEEN 0 AND 10);
ALTER TABLE public.campaign_leads
  ADD COLUMN ai_line text,
  ADD COLUMN nurture_sent_at timestamptz;

DROP INDEX IF EXISTS public.campaign_leads_follow_up_due_idx;
CREATE INDEX campaign_leads_follow_up_due_idx
  ON public.campaign_leads (owner_id, status, last_sent_at)
  WHERE status = 'sent' AND current_step >= 1 AND sequence_stopped_at IS NULL;

ALTER TABLE public.email_messages ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.app_settings ADD COLUMN auto_close_days integer NOT NULL DEFAULT 14 CHECK (auto_close_days BETWEEN 0 AND 365);

CREATE TABLE public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'email' CHECK (kind IN ('email','follow_up','reply')),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates TO authenticated;
GRANT ALL ON public.templates TO service_role;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own templates" ON public.templates FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER templates_updated BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.conversation_states (
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  thread_id text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, thread_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_states TO authenticated;
GRANT ALL ON public.conversation_states TO service_role;
ALTER TABLE public.conversation_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversation states" ON public.conversation_states FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.close_inactive_conversations()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH last AS (
    SELECT m.owner_id, m.gmail_thread_id AS thread_id, max(coalesce(m.sent_at, m.created_at)) AS last_at
    FROM public.email_messages m
    WHERE m.gmail_thread_id IS NOT NULL AND m.is_test = false
    GROUP BY m.owner_id, m.gmail_thread_id
    HAVING bool_or(m.direction = 'inbound')
  ), due AS (
    SELECT l.owner_id, l.thread_id
    FROM last l
    LEFT JOIN public.app_settings s ON s.owner_id = l.owner_id
    LEFT JOIN public.conversation_states cs ON cs.owner_id = l.owner_id AND cs.thread_id = l.thread_id
    WHERE coalesce(s.auto_close_days, 14) > 0
      AND l.last_at < now() - make_interval(days => coalesce(s.auto_close_days, 14))
      AND (cs.owner_id IS NULL OR (cs.status = 'open' AND cs.updated_at < now() - make_interval(days => coalesce(s.auto_close_days, 14))))
  ), ins AS (
    INSERT INTO public.conversation_states (owner_id, thread_id, status, closed_reason, updated_at)
    SELECT owner_id, thread_id, 'closed', 'inactive', now() FROM due
    ON CONFLICT (owner_id, thread_id) DO UPDATE SET status = 'closed', closed_reason = 'inactive', updated_at = now()
    RETURNING 1
  )
  SELECT count(*)::int FROM ins;
$$;
REVOKE EXECUTE ON FUNCTION public.close_inactive_conversations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_inactive_conversations() TO service_role;

CREATE FUNCTION public.get_inbox_threads(_filter text DEFAULT NULL, _campaign_id uuid DEFAULT NULL, _limit integer DEFAULT 200, _status text DEFAULT 'open')
RETURNS TABLE (
  thread_id text, lead_id uuid, campaign_id uuid, sending_account_id uuid, last_at timestamptz,
  from_email text, subject text, snippet text, reply_category text, reply_summary text,
  unread integer, message_count integer,
  lead_first_name text, lead_last_name text, lead_company text, lead_status text,
  campaign_name text, account_email text, status text, closed_reason text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH t AS (
    SELECT gmail_thread_id AS thread_id FROM public.email_messages
    WHERE direction = 'inbound' AND gmail_thread_id IS NOT NULL
    GROUP BY gmail_thread_id
  ), rows AS (
    SELECT t.thread_id, li.lead_id, li.campaign_id, li.sending_account_id,
      (SELECT max(coalesce(m.sent_at, m.created_at)) FROM public.email_messages m WHERE m.gmail_thread_id = t.thread_id AND m.is_test = false) AS last_at,
      li.from_email, li.subject, left(li.body, 240) AS snippet, li.reply_category, li.reply_summary,
      (SELECT count(*)::int FROM public.email_messages m WHERE m.gmail_thread_id = t.thread_id AND m.direction = 'inbound' AND m.read_at IS NULL) AS unread,
      (SELECT count(*)::int FROM public.email_messages m WHERE m.gmail_thread_id = t.thread_id AND m.is_test = false) AS message_count,
      l.first_name, l.last_name, l.company, l.status AS lead_status, c.name, a.email,
      coalesce(cs.status, 'open') AS status, cs.closed_reason
    FROM t
    CROSS JOIN LATERAL (
      SELECT * FROM public.email_messages i
      WHERE i.gmail_thread_id = t.thread_id AND i.direction = 'inbound'
      ORDER BY coalesce(i.sent_at, i.created_at) DESC LIMIT 1
    ) li
    LEFT JOIN public.leads l ON l.id = li.lead_id
    LEFT JOIN public.campaigns c ON c.id = li.campaign_id
    LEFT JOIN public.sending_accounts a ON a.id = li.sending_account_id
    LEFT JOIN public.conversation_states cs ON cs.owner_id = li.owner_id AND cs.thread_id = t.thread_id
    WHERE (_campaign_id IS NULL OR li.campaign_id = _campaign_id)
  )
  SELECT * FROM rows
  WHERE (coalesce(_status, 'open') = 'all' OR rows.status = coalesce(_status, 'open'))
    AND (_filter IS NULL
     OR (_filter = 'unread' AND rows.unread > 0)
     OR (_filter = 'unsorted' AND rows.reply_category IS NULL)
     OR rows.reply_category = _filter)
  ORDER BY rows.last_at DESC NULLS LAST
  LIMIT greatest(1, least(_limit, 500));
$$;
GRANT EXECUTE ON FUNCTION public.get_inbox_threads(text, uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'total_leads', (SELECT count(*) FROM public.leads),
    'emails_sent', (SELECT count(*) FROM public.email_messages WHERE direction='outbound' AND is_test = false AND status IN ('sent','bounced')),
    'bounced', (SELECT count(*) FROM public.leads WHERE status='bounced'),
    'replies', (SELECT count(DISTINCT lead_id) FROM public.email_messages WHERE direction='inbound' AND lead_id IS NOT NULL AND coalesce(reply_category,'') <> 'bounce'),
    'interested', (SELECT count(*) FROM public.leads WHERE status='interested'),
    'meetings', (SELECT count(*) FROM public.leads WHERE status='meeting_requested'),
    'pending_follow_ups', (
      SELECT count(DISTINCT cl.id)
      FROM public.campaign_leads cl
      JOIN public.campaigns c ON c.id = cl.campaign_id AND c.status = 'active'
      JOIN public.leads l ON l.id = cl.lead_id
      WHERE cl.status = 'sent'
        AND cl.current_step >= 1
        AND cl.current_step <= jsonb_array_length(c.follow_ups)
        AND cl.last_sent_at IS NOT NULL
        AND cl.sequence_stopped_at IS NULL
        AND l.status NOT IN ('unsubscribed','bounced')
        AND NOT EXISTS (SELECT 1 FROM public.email_messages im WHERE im.campaign_lead_id = cl.id AND im.direction = 'inbound' AND coalesce(im.reply_category,'') <> 'out_of_office')
    ),
    'queued', (SELECT count(*) FROM public.campaign_leads cl JOIN public.campaigns c ON c.id = cl.campaign_id WHERE cl.status='queued' AND c.status='active'),
    'open_conversations', (
      SELECT count(DISTINCT m.gmail_thread_id) FROM public.email_messages m
      LEFT JOIN public.conversation_states cs ON cs.owner_id = m.owner_id AND cs.thread_id = m.gmail_thread_id
      WHERE m.direction = 'inbound' AND m.gmail_thread_id IS NOT NULL AND coalesce(cs.status, 'open') = 'open'
    ),
    'reply_categories', jsonb_build_object(
      'interested', (SELECT count(DISTINCT lead_id) FROM public.email_messages WHERE direction='inbound' AND reply_category='interested' AND lead_id IS NOT NULL),
      'meeting_request', (SELECT count(DISTINCT lead_id) FROM public.email_messages WHERE direction='inbound' AND reply_category='meeting_request' AND lead_id IS NOT NULL),
      'follow_up_later', (SELECT count(DISTINCT lead_id) FROM public.email_messages WHERE direction='inbound' AND reply_category='follow_up_later' AND lead_id IS NOT NULL),
      'not_interested', (SELECT count(DISTINCT lead_id) FROM public.email_messages WHERE direction='inbound' AND reply_category='not_interested' AND lead_id IS NOT NULL),
      'unsubscribe', (SELECT count(DISTINCT lead_id) FROM public.email_messages WHERE direction='inbound' AND reply_category='unsubscribe' AND lead_id IS NOT NULL)
    ),
    'by_status', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) n FROM public.leads GROUP BY status) s)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;

CREATE POLICY "own attachment files read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own attachment files insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own attachment files delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);