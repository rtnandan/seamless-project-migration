// Works out a mailbox's servers from its email address and the domain's mail (MX) records,
// so people only type their email and password. Pure, so it can be tested.

export type ServerCandidate = { smtpHost: string; smtpPort: number; imapHost: string; imapPort: number };
export type Detected = { providerKey: string; candidates: ServerCandidate[] };

const c = (smtpHost: string, imapHost: string, smtpPort = 465): ServerCandidate => ({ smtpHost, smtpPort, imapHost, imapPort: 993 });

export function detectMailbox(email: string, mxRecords: string[]): Detected {
  const domain = (email.trim().toLowerCase().split("@")[1] ?? "").replace(/\.$/, "");
  const mx = mxRecords.map((r) => r.toLowerCase().replace(/\.$/, "")).join(" ");

  if (["gmail.com", "googlemail.com"].includes(domain) || /(google|googlemail)\.com/.test(mx))
    return { providerKey: "gmail", candidates: [c("smtp.gmail.com", "imap.gmail.com")] };

  if (domain === "zohomail.in") return { providerKey: "zoho_in", candidates: [c("smtp.zoho.in", "imap.zoho.in")] };
  if (["zohomail.com", "zoho.com"].includes(domain)) return { providerKey: "zoho_com", candidates: [c("smtp.zoho.com", "imap.zoho.com")] };
  // Business (own-domain) Zoho mailboxes use the "pro" servers; personal ones the plain servers.
  if (/zoho\.in\b/.test(mx)) return { providerKey: "zoho_in", candidates: [c("smtppro.zoho.in", "imappro.zoho.in"), c("smtp.zoho.in", "imap.zoho.in")] };
  if (/zoho\.eu\b/.test(mx)) return { providerKey: "zoho_eu", candidates: [c("smtppro.zoho.eu", "imappro.zoho.eu"), c("smtp.zoho.eu", "imap.zoho.eu")] };
  if (/zoho(mail)?\.com\b/.test(mx)) return { providerKey: "zoho_com", candidates: [c("smtppro.zoho.com", "imappro.zoho.com"), c("smtp.zoho.com", "imap.zoho.com")] };

  if (/secureserver\.net/.test(mx))
    return { providerKey: "godaddy", candidates: [c("smtpout.secureserver.net", "imap.secureserver.net"), c("smtpout.secureserver.net", "imap.secureserver.net", 587)] };

  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain))
    return { providerKey: "outlook", candidates: [c("smtp-mail.outlook.com", "outlook.office365.com", 587)] };
  if (/protection\.outlook\.com|outlook\.com/.test(mx))
    return { providerKey: "outlook", candidates: [c("smtp.office365.com", "outlook.office365.com", 587)] };

  // Any other host (cPanel, Hostinger, Titan, …): try the usual names.
  if (/titan\.email/.test(mx)) return { providerKey: "custom", candidates: [c("smtp.titan.email", "imap.titan.email")] };
  if (/hostinger/.test(mx)) return { providerKey: "custom", candidates: [c("smtp.hostinger.com", "imap.hostinger.com")] };
  return {
    providerKey: "custom",
    candidates: [c(`mail.${domain}`, `mail.${domain}`), c(`smtp.${domain}`, `imap.${domain}`), c(`mail.${domain}`, `mail.${domain}`, 587), c(`smtp.${domain}`, `imap.${domain}`, 587)],
  };
}

/** Candidates for server names typed by hand: try the encrypted port first, then the other one. */
export function manualCandidates(smtpHost: string, imapHost: string): ServerCandidate[] {
  return [c(smtpHost, imapHost), c(smtpHost, imapHost, 587)];
}
