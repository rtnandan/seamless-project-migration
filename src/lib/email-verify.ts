// Pure email-address checks run before anyone is emailed (safe for the browser and tests).

export type EmailCheck = "valid" | "risky" | "invalid";
export type CheckResult = { result: EmailCheck; reason: string };

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com",
  "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com", "maildrop.cc", "throwawaymail.com",
  "fakeinbox.com", "mailnesia.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com",
  "spamgourmet.com", "mailcatch.com", "moakt.com", "burnermail.io", "tempr.email", "discard.email",
]);

const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gnail.com": "gmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "outlok.com": "outlook.com", "rediffmal.com": "rediffmail.com",
};

const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?)$/;
const ROLE = /^(info|admin|sales|support|contact|hello|office|team|marketing|help|enquiry|enquiries|inquiry|hr|jobs|careers|billing|accounts|webmaster)$/;

/** Checks that need no network: format, throwaway domains, typos, no-reply and team inboxes. */
export function basicEmailCheck(raw: string): CheckResult | null {
  const email = raw.trim().toLowerCase();
  if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || email.includes("..")) return { result: "invalid", reason: "Not a valid email address" };
  const [local = "", domain = ""] = email.split("@");
  if (TYPOS[domain]) return { result: "invalid", reason: `Looks like a typo — did you mean ${local}@${TYPOS[domain]}?` };
  if (DISPOSABLE.has(domain)) return { result: "invalid", reason: "Throwaway email address" };
  if (NO_REPLY.test(local)) return { result: "invalid", reason: "No-reply address — nobody reads it" };
  if (ROLE.test(local)) return { result: "risky", reason: "Shared team inbox (e.g. info@) — replies are less likely" };
  return null;
}

export type DnsAnswer = { status: number; records: string[] };

/** Decides from the domain's mail-server (MX) lookup. `a` is the fallback address lookup. */
export function mailServerVerdict(mx: DnsAnswer, a?: DnsAnswer): CheckResult {
  if (mx.status === 3) return { result: "invalid", reason: "The domain doesn't exist" };
  if (mx.status !== 0) return { result: "risky", reason: "Couldn't look up the domain right now" };
  const hosts = mx.records.map((r) => r.trim().split(/\s+/).pop()?.replace(/\.$/, "") ?? "");
  if (hosts.length === 1 && (hosts[0] === "" || hosts[0] === ".")) return { result: "invalid", reason: "The domain says it accepts no email" };
  if (hosts.some((h) => h && h !== ".")) return { result: "valid", reason: "The domain accepts email" };
  if (a && a.status === 0 && a.records.length) return { result: "risky", reason: "The domain has no mail server listed" };
  return { result: "invalid", reason: "The domain has no mail server" };
}
