// Server-only: reads new emails from a mailbox account's inbox (Zoho, GoDaddy, …) and saves
// replies to our emails; bounce notices put the address on the suppression list.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { markBounced } from "./bounces.server";
import { getAccountPassword } from "./credentials.server";
import { withImap } from "./imap.server";
import { imapDate, messageIdsIn } from "./mail-protocol";
import { parseFailedRecipients } from "./mime";
import { extractReplyText, htmlToText, parseAddress, quickCategory } from "./replies";
import { saveInbound } from "./replies.server";

type DB = SupabaseClient<Database>;
type Account = Database["public"]["Tables"]["sending_accounts"]["Row"];

const MAX_HEADERS = 150;
const MAX_FULL = 10;

export async function syncImapAccount(db: DB, account: Account): Promise<{ newReplies: number; notes: string[] }> {
  const out = { newReplies: 0, notes: [] as string[] };
  if (!account.imap_host) return out;
  const password = await getAccountPassword(account.id);
  const username = account.username || account.email;

  await withImap({ host: account.imap_host, port: account.imap_port ?? 993, username, password }, async (s) => {
    const { uidValidity } = await s.selectInbox();
    const continuing = account.imap_uidvalidity === uidValidity && account.imap_last_uid != null;
    const last = continuing ? Number(account.imap_last_uid) : 0;
    const since = new Date(Date.now() - 14 * 86_400_000);
    const uids = (await s.search(continuing ? `UID ${last + 1}:*` : `SINCE ${imapDate(since)}`)).filter((u) => u > last).slice(0, MAX_HEADERS);
    if (!uids.length) {
      if (!continuing) await db.from("sending_accounts").update({ imap_uidvalidity: uidValidity, imap_last_uid: last }).eq("id", account.id);
      return;
    }
    const heads = await s.fetchHeaders(uids);
    heads.sort((a, b) => a.uid - b.uid);

    // Which of these answer an email we sent?
    const refsOf = (h: Record<string, string>) => [...messageIdsIn(h["in-reply-to"]), ...messageIdsIn(h["references"])];
    const allRefs = [...new Set(heads.flatMap((h) => refsOf(h.headers)))];
    const ours = new Map<string, { owner_id: string; lead_id: string | null; campaign_id: string | null; campaign_lead_id: string | null; gmail_thread_id: string | null; to_email: string; id: string; status: string }>();
    for (let i = 0; i < allRefs.length; i += 100) {
      const { data } = await db
        .from("email_messages")
        .select("id, owner_id, lead_id, campaign_id, campaign_lead_id, gmail_thread_id, rfc_message_id, to_email, status")
        .eq("sending_account_id", account.id)
        .eq("direction", "outbound")
        .eq("is_test", false)
        .in("rfc_message_id", allRefs.slice(i, i + 100));
      for (const m of data ?? []) if (m.rfc_message_id) ours.set(m.rfc_message_id, m);
    }
    const ids = heads.map((h) => h.headers["message-id"]).filter((x): x is string => !!x);
    const known = new Set<string>();
    if (ids.length) {
      const { data } = await db.from("email_messages").select("gmail_message_id").eq("direction", "inbound").eq("sending_account_id", account.id).in("gmail_message_id", ids);
      for (const k of data ?? []) if (k.gmail_message_id) known.add(k.gmail_message_id);
    }

    let fullReads = 0;
    let lastDone = last;
    for (const h of heads) {
      const from = (h.headers["from"] ?? "").toLowerCase();
      const isBounce = /mailer-daemon|postmaster/.test(from);
      const match = refsOf(h.headers).map((r) => ours.get(r)).find(Boolean);
      const providerId = h.headers["message-id"] || `imap:${uidValidity}:${h.uid}`;
      if ((!match && !isBounce) || known.has(providerId)) {
        lastDone = h.uid;
        continue;
      }
      if (fullReads >= MAX_FULL) break; // the rest next run
      fullReads++;
      const raw = await s.fetchRaw(h.uid);
      lastDone = h.uid;
      if (!raw) continue;
      const PostalMime = (await import("postal-mime")).default;
      const parsed = await PostalMime.parse(raw);
      const text = parsed.text || (parsed.html ? htmlToText(parsed.html) : "");

      if (isBounce) {
        const attachText = (parsed.attachments ?? [])
          .map((a) => (typeof a.content === "string" ? a.content : new TextDecoder().decode(a.content as ArrayBuffer)))
          .join("\n");
        const all = `${text}\n${attachText}`;
        const failed = new Set([
          ...parseFailedRecipients(h.headers["x-failed-recipients"]),
          ...[...all.matchAll(/Final-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi)].map((m) => m[1]!.toLowerCase()),
        ]);
        const target = match ? [match] : [];
        if (!target.length) {
          for (const email of failed) {
            const { data: m } = await db
              .from("email_messages")
              .select("id, owner_id, lead_id, campaign_id, campaign_lead_id, gmail_thread_id, to_email, status")
              .eq("sending_account_id", account.id)
              .eq("direction", "outbound")
              .eq("to_email", email)
              .eq("status", "sent")
              .order("sent_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (m) target.push(m);
          }
        }
        for (const m of target) if (m.status === "sent" && (failed.size === 0 || failed.has(m.to_email.toLowerCase()))) await markBounced(db, m);
        continue;
      }

      if (!match || !match.lead_id) continue;
      const fromEmail = parseAddress(h.headers["from"]);
      if (fromEmail === account.email.toLowerCase()) continue; // our own copy
      const subject = h.headers["subject"] ?? parsed.subject ?? "";
      const reply = extractReplyText(text);
      const quick = quickCategory({
        subject,
        text: reply,
        autoSubmitted: h.headers["auto-submitted"],
        autoReplyHeader: !!(h.headers["x-autoreply"] || h.headers["x-autorespond"]),
      });
      const saved = await saveInbound(db, {
        sent: match,
        accountId: account.id,
        accountEmail: account.email,
        fromEmail,
        subject,
        text: reply,
        receivedAt: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
        providerMessageId: providerId,
        threadKey: match.gmail_thread_id ?? providerId,
        rfcMessageId: h.headers["message-id"] ?? null,
        inReplyTo: h.headers["in-reply-to"] ?? null,
        quick,
      });
      if (saved) out.newReplies++;
    }
    await db
      .from("sending_accounts")
      .update({ imap_uidvalidity: uidValidity, imap_last_uid: lastDone, last_checked_at: new Date().toISOString() })
      .eq("id", account.id);
  });
  return out;
}
