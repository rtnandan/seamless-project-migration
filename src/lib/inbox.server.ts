// Server-only: answers a conversation from the account it came in on, keeping it in the same thread.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { renderTemplate } from "./email-utils";
import { sendFromAccount } from "./mailer.server";
import { replySubject } from "./mime";
import { appendLinks, type Attachment } from "./attachments";
import { pickSignature } from "./compose";

type DB = SupabaseClient<Database>;

export async function sendThreadReply(
  db: DB,
  input: { threadId: string; body: string; cc: string[]; to?: string | undefined; includeSignature: boolean; attachments?: Attachment[] | undefined },
) {
  const { data: msgs, error } = await db
    .from("email_messages")
    .select("*")
    .eq("gmail_thread_id", input.threadId)
    .eq("is_test", false)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  if (!msgs?.length) throw new Error("Conversation not found");
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
  const firstOut = msgs.find((m) => m.direction === "outbound");
  const anchor = lastInbound ?? msgs[msgs.length - 1]!;
  const accountId = anchor.sending_account_id ?? firstOut?.sending_account_id;
  if (!accountId) throw new Error("This conversation's sending account was removed.");
  const { data: account } = await db.from("sending_accounts").select("*").eq("id", accountId).single();
  if (!account) throw new Error("This conversation's sending account was removed.");

  const to = (input.to || lastInbound?.from_email || firstOut?.to_email || "").trim().toLowerCase();
  if (!to) throw new Error("No one to reply to");
  const { data: sup } = await db.from("suppressions").select("reason").eq("email", to).maybeSingle();
  if (sup && sup.reason !== "manual") throw new Error(`${to} is on your suppression list (${sup.reason}).`);

  const { data: lead } = anchor.lead_id ? await db.from("leads").select("*").eq("id", anchor.lead_id).maybeSingle() : { data: null };
  const leadVars = lead ? { ...lead, custom_fields: (lead.custom_fields ?? {}) as Record<string, unknown> } : {};
  const attachments = input.attachments ?? [];
  let body = appendLinks(renderTemplate(input.body, leadVars).trimEnd(), attachments);
  if (input.includeSignature) {
    const { data: settings } = await db.from("app_settings").select("signature").eq("owner_id", account.owner_id).maybeSingle();
    const sig = pickSignature(account.signature, settings?.signature);
    if (sig.trim()) body += `\n\n${renderTemplate(sig, leadVars).trim()}`;
  }
  const { loadAttachmentFiles } = await import("./attachments.server");
  const files = await loadAttachmentFiles(db, attachments, account.owner_id);
  const subject = replySubject(firstOut?.subject || anchor.subject || "");
  const refs = msgs.map((m) => m.rfc_message_id).filter((x): x is string => !!x);
  const inReplyTo = lastInbound?.rfc_message_id ?? refs[refs.length - 1] ?? null;

  const { data: row, error: insErr } = await db
    .from("email_messages")
    .insert({
      owner_id: account.owner_id,
      lead_id: anchor.lead_id,
      campaign_id: anchor.campaign_id,
      direction: "outbound",
      is_manual: true,
      sending_account_id: account.id,
      to_email: to,
      cc: input.cc.join(", "),
      from_email: account.email,
      subject,
      body,
      status: "pending",
      in_reply_to: inReplyTo,
      gmail_thread_id: input.threadId,
      attachments: attachments as unknown as Json,
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(insErr?.message ?? "Couldn't save the reply");
  try {
    const sent = await sendFromAccount(account, { to, cc: input.cc, subject, body, inReplyTo, references: refs, threadKey: input.threadId, attachments: files });
    // Replying reopens a closed conversation.
    await db.from("conversation_states").upsert({ owner_id: account.owner_id, thread_id: input.threadId, status: "open", closed_reason: null, updated_at: new Date().toISOString() });
    const now = new Date().toISOString();
    await db
      .from("email_messages")
      .update({ status: "sent", sent_at: now, rfc_message_id: sent.rfcMessageId, gmail_message_id: sent.providerMessageId })
      .eq("id", row.id);
    await db.from("email_messages").update({ read_at: now }).eq("gmail_thread_id", input.threadId).eq("direction", "inbound").is("read_at", null);
    if (anchor.lead_id) await db.from("leads").update({ last_contacted_at: now }).eq("id", anchor.lead_id);
    return { to };
  } catch (e) {
    await db.from("email_messages").update({ status: "failed", error: (e as Error).message }).eq("id", row.id);
    throw e;
  }
}
