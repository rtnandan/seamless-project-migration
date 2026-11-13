// Server-only: email checks that need DNS lookups (mail servers, SPF, DKIM, DMARC).
import { evaluateDomain, MANAGED_DOMAINS, type DomainHealth } from "./dns-health";
import { basicEmailCheck, mailServerVerdict, type CheckResult, type DnsAnswer } from "./email-verify";

const TYPE = { A: 1, MX: 15, TXT: 16 } as const;

export async function dnsLookup(name: string, type: keyof typeof TYPE): Promise<DnsAnswer> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) return { status: -1, records: [] };
    const j = (await res.json()) as { Status: number; Answer?: { type: number; data: string }[] };
    const records = (j.Answer ?? [])
      .filter((a) => a.type === TYPE[type])
      .map((a) => (type === "TXT" ? a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, "") : a.data));
    return { status: j.Status, records };
  } catch {
    return { status: -1, records: [] };
  }
}

const domainCache = new Map<string, Promise<CheckResult>>();

export async function verifyEmailAddress(email: string): Promise<CheckResult> {
  const basic = basicEmailCheck(email);
  if (basic?.result === "invalid") return basic;
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  let p = domainCache.get(domain);
  if (!p) {
    p = (async () => {
      const mx = await dnsLookup(domain, "MX");
      const a = mx.status === 0 && !mx.records.length ? await dnsLookup(domain, "A") : undefined;
      return mailServerVerdict(mx, a);
    })();
    domainCache.set(domain, p);
  }
  const server = await p;
  if (server.result !== "valid") return server;
  return basic ?? server;
}


/** Looks up SPF, DKIM, DMARC and MX for the domain an account sends from. */
export async function checkDomainHealth(email: string, spfInclude: string | null, selectors: string[]): Promise<DomainHealth> {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  const checkedAt = new Date().toISOString();
  if (MANAGED_DOMAINS.has(domain)) {
    return {
      domain,
      managed: true,
      checkedAt,
      items: [{ key: "spf", label: "SPF, DKIM, DMARC", level: "pass", message: `${domain} is run by the email provider, which sets these up for you. For cold email at volume, a custom domain is better.` }],
    };
  }
  const unique = [...new Set(selectors.map((s) => s.trim()).filter(Boolean))].slice(0, 8);
  const [txt, dmarc, mx, ...dkim] = await Promise.all([
    dnsLookup(domain, "TXT"),
    dnsLookup(`_dmarc.${domain}`, "TXT"),
    dnsLookup(domain, "MX"),
    ...unique.map((s) => dnsLookup(`${s}._domainkey.${domain}`, "TXT")),
  ]);
  return {
    domain,
    managed: false,
    checkedAt,
    items: evaluateDomain({
      domain,
      spfInclude,
      txt: txt.records,
      dmarcTxt: dmarc.records,
      mx: mx.records,
      dkim: unique.map((selector, i) => ({ selector, found: (dkim[i]?.records ?? []).some((r) => /v=DKIM1|k=rsa|p=/i.test(r)) })),
    }),
  };
}
