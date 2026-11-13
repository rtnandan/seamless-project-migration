// Server-only: sends one email from any sending account (Gmail connection or mailbox sign-in).
import type { Database } from "@/integrations/supabase/types";
import { buildMimeMessage, type MimeAttachment } from "./mime";
import { hasFormatting, toHtml, toPlainText } from "./rich-text";

export type SendingAccount = Database["public"]["Tables"]["sending_accounts"]["Row"];

export type OutgoingEmail = {
  to: string;
  cc?: string[] | undefined;
  subject: string;
  body: string;
  /** Message-ID of the email being answered (keeps the conversation together). */
  inReplyTo?: string | null | undefined;
  references?: string[] | undefined;
  /** Conversation id already used for this thread, if any. */
  threadKey?: string | null | undefined;
  /** Files to attach (already loaded from storage). */
  attachments?: MimeAttachment[] | undefined;
};

export type SentResult = { rfcMessageId: string; providerMessageId: string; threadKey: string };

export function newMessageId(fromEmail: string) {
  const domain = fromEmail.split("@")[1] || "mail.local";
  return `<${crypto.randomUUID()}@${domain}>`;
}

export async function sendFromAccount(account: SendingAccount, email: OutgoingEmail): Promise<SentResult> {
  const rfcMessageId = newMessageId(account.email);
  const mime = buildMimeMessage({
    from: account.email,
    fromName: account.from_name,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    // The body may hold [label](url) links and **bold**: send plain text plus an HTML version.
    body: toPlainText(email.body),
    html: hasFormatting(email.body) ? toHtml(email.body) : undefined,
    attachments: email.attachments,
    messageId: rfcMessageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
    date: new Date(),
  });

  if (account.provider === "smtp") {
    const { smtpSend } = await import("./smtp.server");
    const { getAccountPassword } = await import("./credentials.server");
    if (!account.smtp_host || !account.smtp_port) throw new Error("This account has no outgoing mail server set.");
    await smtpSend(
      { host: account.smtp_host, port: account.smtp_port, username: account.username || account.email, password: await getAccountPassword(account.id) },
      { from: account.email, recipients: [email.to, ...(email.cc ?? [])] },
      mime,
    );
    return { rfcMessageId, providerMessageId: rfcMessageId, threadKey: email.threadKey || rfcMessageId };
  }

  const { sendGmail } = await import("./gmail.server");
  const { b64 } = await import("./mime");
  const raw = b64(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // Gmail conversation ids never contain "<"; older rows without one start a new conversation.
  const gmailThread = email.threadKey && !email.threadKey.includes("<") ? email.threadKey : null;
  const sent = await sendGmail(account.secret_name, raw, gmailThread);
  return { rfcMessageId, providerMessageId: sent.id, threadKey: sent.threadId };
}

/** Signs in to the account's mail servers without sending anything. */
export async function testAccountConnection(account: SendingAccount, password?: string) {
  if (account.provider !== "smtp") {
    const { getGmailProfile } = await import("./gmail.server");
    await getGmailProfile(account.secret_name);
    return { sending: true, inbox: true };
  }
  const { smtpVerify } = await import("./smtp.server");
  const { withImap } = await import("./imap.server");
  const pw = password ?? (await (await import("./credentials.server")).getAccountPassword(account.id));
  const username = account.username || account.email;
  await smtpVerify({ host: account.smtp_host ?? "", port: account.smtp_port ?? 465, username, password: pw });
  let inbox = false;
  if (account.imap_host) {
    await withImap({ host: account.imap_host, port: account.imap_port ?? 993, username, password: pw }, (s) => s.selectInbox());
    inbox = true;
  }
  return { sending: true, inbox };
}
