ALTER TABLE public.sending_accounts
  ADD COLUMN provider text NOT NULL DEFAULT 'gmail_api' CHECK (provider IN ('gmail_api','smtp')),
  ADD COLUMN provider_label text NOT NULL DEFAULT 'Gmail',
  ADD COLUMN username text,
  ADD COLUMN smtp_host text,
  ADD COLUMN smtp_port integer,
  ADD COLUMN imap_host text,
  ADD COLUMN imap_port integer,
  ADD COLUMN imap_last_uid bigint,
  ADD COLUMN imap_uidvalidity bigint,
  ADD COLUMN dkim_selector text,
  ADD COLUMN dns_check jsonb,
  ADD COLUMN dns_checked_at timestamptz;

CREATE TABLE public.account_credentials (
  account_id uuid PRIMARY KEY REFERENCES public.sending_accounts(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  password_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.account_credentials TO service_role;
ALTER TABLE public.account_credentials ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER account_credentials_updated BEFORE UPDATE ON public.account_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.leads
  ADD COLUMN email_check text NOT NULL DEFAULT 'unchecked' CHECK (email_check IN ('unchecked','valid','risky','invalid')),
  ADD COLUMN email_check_reason text,
  ADD COLUMN email_checked_at timestamptz;

ALTER TABLE public.email_messages
  ADD COLUMN is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN cc text NOT NULL DEFAULT '',
  ADD COLUMN in_reply_to text,
  ADD COLUMN read_at timestamptz;

CREATE INDEX email_messages_owner_thread_idx ON public.email_messages (owner_id, gmail_thread_id);
CREATE INDEX email_messages_rfc_idx ON public.email_messages (sending_account_id, rfc_message_id) WHERE rfc_message_id IS NOT NULL;
CREATE INDEX email_messages_outbound_sent_idx ON public.email_messages (owner_id, sent_at DESC) WHERE direction = 'outbound' AND is_test = false;