// Pure SPF / DKIM / DMARC evaluation for a sending domain (safe for the browser and tests).

export type HealthLevel = "pass" | "warn" | "fail";
export type HealthItem = { key: "spf" | "dkim" | "dmarc" | "mx"; label: string; level: HealthLevel; message: string; fix?: string };
export type DomainHealth = { domain: string; managed: boolean; items: HealthItem[]; checkedAt: string };

/** Free mailbox domains: the provider already sets SPF/DKIM/DMARC, nothing to do. */
export const MANAGED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "zohomail.in", "zohomail.com", "zoho.com", "zoho.in", "outlook.com",
  "hotmail.com", "live.com", "yahoo.com", "icloud.com", "rediffmail.com",
]);

export function evaluateDomain(input: {
  domain: string;
  spfInclude: string | null;
  txt: string[];
  dmarcTxt: string[];
  dkim: { selector: string; found: boolean }[];
  mx: string[];
}): HealthItem[] {
  const items: HealthItem[] = [];
  const spf = input.txt.filter((t) => /^v=spf1\b/i.test(t.trim()));
  const want = input.spfInclude;
  if (spf.length === 0) {
    items.push({
      key: "spf",
      label: "SPF",
      level: "fail",
      message: "Missing — receivers can't tell this server is allowed to send for your domain.",
      fix: `Add a TXT record on ${input.domain}: v=spf1 ${want ? want + " " : ""}~all`,
    });
  } else if (spf.length > 1) {
    items.push({ key: "spf", label: "SPF", level: "fail", message: "There are two SPF records. Only one is allowed — merge them into one.", fix: `Keep a single TXT record that starts with v=spf1 and lists every service${want ? ` (including ${want})` : ""}.` });
  } else if (want && !spf[0]!.toLowerCase().includes(want.toLowerCase())) {
    items.push({ key: "spf", label: "SPF", level: "fail", message: `Your SPF record doesn't include this provider (${want}).`, fix: `Edit it to: ${spf[0]!.replace(/\s*[~\-?+]all\s*$/i, "")} ${want} ~all` });
  } else if (/\+all/i.test(spf[0]!)) {
    items.push({ key: "spf", label: "SPF", level: "warn", message: "SPF ends with +all, which lets anyone send as you.", fix: "Change +all to ~all." });
  } else {
    items.push({ key: "spf", label: "SPF", level: "pass", message: spf[0]! });
  }

  const found = input.dkim.find((d) => d.found);
  items.push(
    found
      ? { key: "dkim", label: "DKIM", level: "pass", message: `Signing key found (selector “${found.selector}”).` }
      : {
          key: "dkim",
          label: "DKIM",
          level: "fail",
          message: `No signing key found${input.dkim.length ? ` (looked for: ${input.dkim.map((d) => d.selector).join(", ")})` : ""}.`,
          fix: "Turn on DKIM in your email provider's admin panel. It gives you a TXT record (name like selector._domainkey) to add to your domain. If you used a different selector name, enter it below and check again.",
        },
  );

  const dmarc = input.dmarcTxt.find((t) => /^v=DMARC1\b/i.test(t.trim()));
  if (!dmarc) {
    items.push({
      key: "dmarc",
      label: "DMARC",
      level: "fail",
      message: "Missing — Gmail and Yahoo expect it from anyone sending regularly.",
      fix: `Add a TXT record named _dmarc.${input.domain} with: v=DMARC1; p=none; rua=mailto:dmarc@${input.domain}`,
    });
  } else {
    const p = dmarc.match(/\bp=(\w+)/i)?.[1]?.toLowerCase();
    items.push({ key: "dmarc", label: "DMARC", level: "pass", message: `Set (policy: ${p ?? "none"}). ${dmarc}` });
  }

  items.push(
    input.mx.length
      ? { key: "mx", label: "Inbox (MX)", level: "pass", message: "Your domain can receive replies." }
      : { key: "mx", label: "Inbox (MX)", level: "fail", message: "Your domain has no mail server, so replies can't arrive.", fix: "Add the MX records your email provider gives you." },
  );
  return items;
}
