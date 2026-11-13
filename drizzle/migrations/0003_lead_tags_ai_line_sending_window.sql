ALTER TABLE public.leads
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN ai_line text,
  ADD COLUMN ai_line_at timestamptz;
CREATE INDEX leads_tags_idx ON public.leads USING gin (tags);

ALTER TABLE public.app_settings
  ADD COLUMN send_start_hour integer NOT NULL DEFAULT 0 CHECK (send_start_hour BETWEEN 0 AND 23),
  ADD COLUMN send_end_hour integer NOT NULL DEFAULT 24 CHECK (send_end_hour BETWEEN 1 AND 24),
  ADD COLUMN send_weekdays_only boolean NOT NULL DEFAULT false,
  ADD COLUMN ai_context text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.campaign_leads.ai_line IS 'DEPRECATED: personal lines live on leads.ai_line';