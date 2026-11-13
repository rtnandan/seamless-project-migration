CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.app_settings (
  owner_id uuid PRIMARY KEY,
  app_url text,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  signature text NOT NULL DEFAULT '',
  first_campaign_approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.app_settings FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER app_settings_updated BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sending_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  email text NOT NULL,
  from_name text NOT NULL DEFAULT '',
  secret_name text NOT NULL,
  daily_limit integer NOT NULL DEFAULT 250 CHECK (daily_limit BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','error','rate_limited')),
  last_error text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, secret_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sending_accounts TO authenticated;
GRANT ALL ON public.sending_accounts TO service_role;
ALTER TABLE public.sending_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own accounts" ON public.sending_accounts FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER sending_accounts_updated BEFORE UPDATE ON public.sending_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  email text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  designation text NOT NULL DEFAULT '',
  industry text NOT NULL DEFAULT '',
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'not_contacted' CHECK (status IN ('not_contacted','email_sent','delivered','replied','interested','meeting_requested','follow_up_required','not_interested','unsubscribed','bounced')),
  source text NOT NULL DEFAULT 'manual',
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  last_contacted_at timestamptz,
  last_replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own leads" ON public.leads FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE INDEX leads_owner_status_idx ON public.leads (owner_id, status);
CREATE INDEX leads_owner_created_idx ON public.leads (owner_id, created_at DESC);
CREATE TRIGGER leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.normalize_email_col()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.email = lower(btrim(NEW.email)); RETURN NEW; END; $$;
CREATE TRIGGER leads_normalize_email BEFORE INSERT OR UPDATE OF email ON public.leads FOR EACH ROW EXECUTE FUNCTION public.normalize_email_col();

CREATE TABLE public.suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  email text NOT NULL,
  reason text NOT NULL DEFAULT 'manual' CHECK (reason IN ('unsubscribe','bounce','manual','complaint')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppressions TO authenticated;
GRANT ALL ON public.suppressions TO service_role;
ALTER TABLE public.suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own suppressions" ON public.suppressions FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER suppressions_normalize_email BEFORE INSERT OR UPDATE OF email ON public.suppressions FOR EACH ROW EXECUTE FUNCTION public.normalize_email_col();

CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')),
  account_ids uuid[] NOT NULL DEFAULT '{}',
  daily_limit integer NOT NULL DEFAULT 250 CHECK (daily_limit BETWEEN 1 AND 5000),
  batch_size integer NOT NULL DEFAULT 5 CHECK (batch_size BETWEEN 1 AND 5),
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own campaigns" ON public.campaigns FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER campaigns_updated BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.campaign_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','skipped')),
  sending_account_id uuid REFERENCES public.sending_accounts(id) ON DELETE SET NULL,
  gmail_thread_id text,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_leads TO authenticated;
GRANT ALL ON public.campaign_leads TO service_role;
ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own campaign leads" ON public.campaign_leads FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE INDEX campaign_leads_campaign_status_idx ON public.campaign_leads (campaign_id, status);
CREATE INDEX campaign_leads_lead_idx ON public.campaign_leads (lead_id);
CREATE TRIGGER campaign_leads_updated BEFORE UPDATE ON public.campaign_leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  campaign_lead_id uuid REFERENCES public.campaign_leads(id) ON DELETE CASCADE,
  step integer NOT NULL DEFAULT 0,
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  is_test boolean NOT NULL DEFAULT false,
  sending_account_id uuid REFERENCES public.sending_accounts(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  from_email text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','bounced','received')),
  gmail_message_id text,
  gmail_thread_id text,
  error text,
  reply_category text CHECK (reply_category IS NULL OR reply_category = ANY (ARRAY['interested','meeting_request','need_more_info','not_interested','follow_up_later','out_of_office','unsubscribe','bounce','other'])),
  reply_summary text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own email messages" ON public.email_messages FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE UNIQUE INDEX email_messages_one_per_step ON public.email_messages (campaign_lead_id, step) WHERE campaign_lead_id IS NOT NULL AND direction = 'outbound';
CREATE UNIQUE INDEX email_messages_inbound_once ON public.email_messages (owner_id, gmail_message_id) WHERE direction = 'inbound' AND gmail_message_id IS NOT NULL;
CREATE INDEX email_messages_account_sent_idx ON public.email_messages (sending_account_id, sent_at);
CREATE INDEX email_messages_lead_idx ON public.email_messages (lead_id, created_at DESC);
CREATE INDEX email_messages_thread_idx ON public.email_messages (gmail_thread_id);
CREATE INDEX email_messages_inbound_idx ON public.email_messages (owner_id, sent_at DESC) WHERE direction = 'inbound';

CREATE OR REPLACE FUNCTION public.get_campaign_stats()
RETURNS TABLE (campaign_id uuid, total bigint, queued bigint, sending bigint, sent bigint, failed bigint, skipped bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT campaign_id, count(*), count(*) FILTER (WHERE status='queued'), count(*) FILTER (WHERE status='sending'), count(*) FILTER (WHERE status='sent'), count(*) FILTER (WHERE status='failed'), count(*) FILTER (WHERE status='skipped') FROM campaign_leads GROUP BY campaign_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sent_counts_since(_since timestamptz)
RETURNS TABLE (sending_account_id uuid, campaign_id uuid, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT sending_account_id, campaign_id, count(*) FROM email_messages WHERE direction='outbound' AND sent_at >= _since AND status IN ('sent','bounced') GROUP BY sending_account_id, campaign_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_sent_counts_since(timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enroll_leads(_campaign_id uuid, _statuses text[] DEFAULT NULL, _lead_ids uuid[] DEFAULT NULL, _skip_contacted boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = _campaign_id) THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  INSERT INTO campaign_leads (owner_id, campaign_id, lead_id)
  SELECT l.owner_id, _campaign_id, l.id FROM leads l
  WHERE (_statuses IS NULL OR l.status = ANY(_statuses))
    AND (_lead_ids IS NULL OR l.id = ANY(_lead_ids))
    AND l.status NOT IN ('unsubscribed','bounced')
    AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.owner_id = l.owner_id AND s.email = l.email)
    AND (NOT _skip_contacted OR NOT EXISTS (SELECT 1 FROM campaign_leads o WHERE o.lead_id = l.id AND o.campaign_id <> _campaign_id AND o.status IN ('queued','sending','sent')))
  ON CONFLICT (campaign_id, lead_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF EXISTS (SELECT 1 FROM campaigns WHERE id = _campaign_id AND status = 'completed') AND n > 0 THEN UPDATE campaigns SET status = 'paused', completed_at = NULL WHERE id = _campaign_id; END IF;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.enroll_leads(uuid, text[], uuid[], boolean) TO authenticated;

ALTER TABLE public.campaigns
  ADD COLUMN follow_up_1_delay_days integer NOT NULL DEFAULT 3 CHECK (follow_up_1_delay_days BETWEEN 1 AND 365),
  ADD COLUMN follow_up_1_body text NOT NULL DEFAULT '',
  ADD COLUMN follow_up_2_delay_days integer NOT NULL DEFAULT 4 CHECK (follow_up_2_delay_days BETWEEN 1 AND 365),
  ADD COLUMN follow_up_2_body text NOT NULL DEFAULT '',
  ADD COLUMN follow_up_3_delay_days integer NOT NULL DEFAULT 5 CHECK (follow_up_3_delay_days BETWEEN 1 AND 365),
  ADD COLUMN follow_up_3_body text NOT NULL DEFAULT '';

ALTER TABLE public.campaign_leads
  ADD COLUMN current_step integer NOT NULL DEFAULT 0 CHECK (current_step BETWEEN 0 AND 4),
  ADD COLUMN last_sent_at timestamptz,
  ADD COLUMN sequence_stopped_at timestamptz,
  ADD COLUMN sequence_claimed_at timestamptz,
  ADD COLUMN sequence_claimed_step integer;

ALTER TABLE public.email_messages
  ADD COLUMN rfc_message_id text;

CREATE INDEX campaign_leads_follow_up_due_idx
  ON public.campaign_leads (owner_id, status, last_sent_at)
  WHERE status = 'sent' AND current_step BETWEEN 1 AND 3 AND sequence_stopped_at IS NULL;

CREATE INDEX email_messages_campaign_step_idx
  ON public.email_messages (campaign_id, direction, step, status);

COMMENT ON COLUMN public.campaign_leads.current_step IS 'Highest sequence step successfully sent: 0 means none; 1 is initial outreach; 2-4 are follow-ups.';
COMMENT ON COLUMN public.email_messages.rfc_message_id IS 'RFC 5322 Message-ID used for Gmail reply threading.';