// Pure helpers for talking to mail servers (kept separate so they can be tested).

/** SMTP: a line starting with "." must be doubled so it isn't read as the end of the message. */
export function dotStuff(mime: string): string {
  const normalized = mime.replace(/\r?\n/g, "\r\n");
  return normalized.replace(/^\./, "..").replace(/\r\n\./g, "\r\n..");
}

export type MailErrorKind = "auth" | "rate_limit" | "recipient" | "config" | "other";

export function smtpErrorKind(code: number, text: string, stage: string): MailErrorKind {
  if (stage === "the sign-in" || code === 535 || code === 534 || code === 530) return "auth";
  if (/limit|quota|too many|rate|exceeded|5\.4\.5|4\.7\.0/i.test(text) && code >= 421) return "rate_limit";
  if (stage === "the recipient" && code >= 550) return "recipient";
  if (code === 421) return "rate_limit";
  return "other";
}

/** Plain-language hint for a refused mailbox sign-in, based on what the server said. */
export function signInHint(text: string): string {
  if (/gsmtp|google|BadCredentials/i.test(text))
    return "Google refused the password. Gmail and Google Workspace don't accept your normal password here — turn on 2-step verification, create an app password at myaccount.google.com/apppasswords, and paste that 16-letter code instead.";
  if (/zoho/i.test(text))
    return "Zoho refused the password. Check IMAP access is on in Zoho Mail settings, and if 2-step sign-in is on, use an app password from accounts.zoho.in → Security → App passwords.";
  return "The mail server refused the email and password. Check them, and if the account has 2-step sign-in, use an app password instead of your normal password.";
}

/** IMAP quoted string. */
export function imapQuote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** IMAP SEARCH date: 05-Nov-2026 */
export function imapDate(d: Date): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, "0")}-${m}-${d.getUTCFullYear()}`;
}

/** Parses a block of raw mail headers into a lower-cased map (folded lines joined). */
export function parseHeaderBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!(k in out)) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

/** All <message-ids> in an In-Reply-To / References header. */
export function messageIdsIn(header: string | null | undefined): string[] {
  return [...new Set((header ?? "").match(/<[^<>\s]+>/g) ?? [])];
}
