<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Application structure
- Keep outreach screens in TanStack file routes, shared outreach UI in `src/components/app`, and email/data workflows in client-safe, server-only (`*.server.ts`), or `*.functions.ts` modules; this keeps Gmail/AI credentials server-side.
- Scheduled jobs are authenticated `/api/public/jobs/*` routes using `authenticateCronRequest`; keep their paths stable because managed schedules call them.
- Sending accounts are provider-neutral: Gmail connector accounts use the Gmail API, every other mailbox uses SMTP to send and read-only IMAP for replies/bounces via `mailer.server.ts`; servers are auto-detected from the address's MX records in pure `mailbox-detect.ts` so the connect form only asks for email and password; mailbox passwords are AES-GCM encrypted with `MAIL_CREDENTIALS_KEY` in the service-role-only `account_credentials` table so the browser never sees them.
- Follow-ups are sent by the existing send-batch job as same-thread replies (In-Reply-To/References) and stop when `campaign_leads.sequence_stopped_at` is set by a reply, bounce or unsubscribe; keep follow-up timing logic in pure `followups.ts` so it stays tested.
