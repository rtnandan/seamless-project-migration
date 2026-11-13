// Mail provider presets shown when adding a sending account (safe for the browser).

export type ProviderPreset = {
  key: string;
  label: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  /** What to add to the domain's SPF record. */
  spfInclude: string | null;
  /** Usual DKIM selector names to look for. */
  dkimSelectors: string[];
  suggestedDailyLimit: number;
  help: string;
  /** Steps to get the password this app needs, shown before the password box. */
  passwordSteps: string[];
  /** Page where the user creates an app password (opens in a new tab). */
  passwordLink: { label: string; url: string } | null;
  /** Second link (e.g. turning on IMAP). */
  extraLink?: { label: string; url: string };
  /** True when a normal password is refused and an app password is required. */
  needsAppPassword: boolean;
};

export const PROVIDERS: ProviderPreset[] = [
  {
    key: "zoho_in",
    label: "Zoho Mail (India — zoho.in)",
    smtpHost: "smtppro.zoho.in",
    smtpPort: 465,
    imapHost: "imappro.zoho.in",
    imapPort: 993,
    spfInclude: "include:zoho.in",
    dkimSelectors: ["zmail", "zoho", "default"],
    suggestedDailyLimit: 100,
    help: "In Zoho Mail: Settings → Mail Accounts → IMAP → turn IMAP access on. If you use 2-step sign-in, create an app password (accounts.zoho.in → Security → App passwords) and use it here. For a free @zohomail.in address use smtp.zoho.in and imap.zoho.in.",
    passwordSteps: ["Turn on IMAP in Zoho Mail (button below) so replies can be read.", "If Zoho asks for a code when you sign in, create an app password and paste it here. Otherwise your normal Zoho password works."],
    passwordLink: { label: "Create Zoho app password", url: "https://accounts.zoho.in/home#security/app_password" },
    extraLink: { label: "Turn on IMAP in Zoho", url: "https://mail.zoho.in/zm/#settings/all/mailaccounts" },
    needsAppPassword: false,
  },
  {
    key: "zoho_com",
    label: "Zoho Mail (global — zoho.com)",
    smtpHost: "smtppro.zoho.com",
    smtpPort: 465,
    imapHost: "imappro.zoho.com",
    imapPort: 993,
    spfInclude: "include:zoho.com",
    dkimSelectors: ["zmail", "zoho", "default"],
    suggestedDailyLimit: 100,
    help: "In Zoho Mail: Settings → Mail Accounts → IMAP → turn IMAP access on. With 2-step sign-in, use an app password from accounts.zoho.com → Security → App passwords.",
    passwordSteps: ["Turn on IMAP in Zoho Mail (button below) so replies can be read.", "If Zoho asks for a code when you sign in, create an app password and paste it here. Otherwise your normal Zoho password works."],
    passwordLink: { label: "Create Zoho app password", url: "https://accounts.zoho.com/home#security/app_password" },
    extraLink: { label: "Turn on IMAP in Zoho", url: "https://mail.zoho.com/zm/#settings/all/mailaccounts" },
    needsAppPassword: false,
  },
  {
    key: "zoho_eu",
    label: "Zoho Mail (Europe — zoho.eu)",
    smtpHost: "smtppro.zoho.eu",
    smtpPort: 465,
    imapHost: "imappro.zoho.eu",
    imapPort: 993,
    spfInclude: "include:zoho.eu",
    dkimSelectors: ["zmail", "zoho", "default"],
    suggestedDailyLimit: 100,
    help: "Zoho Mail hosted in Europe.",
    passwordSteps: ["Turn on IMAP in Zoho Mail so replies can be read.", "If Zoho asks for a code when you sign in, create an app password and paste it here."],
    passwordLink: { label: "Create Zoho app password", url: "https://accounts.zoho.eu/home#security/app_password" },
    extraLink: { label: "Turn on IMAP in Zoho", url: "https://mail.zoho.eu/zm/#settings/all/mailaccounts" },
    needsAppPassword: false,
  },
  {
    key: "godaddy",
    label: "GoDaddy email (Workspace / Professional)",
    smtpHost: "smtpout.secureserver.net",
    smtpPort: 465,
    imapHost: "imap.secureserver.net",
    imapPort: 993,
    spfInclude: "include:secureserver.net",
    dkimSelectors: ["default", "secureserver", "s1", "k1"],
    suggestedDailyLimit: 100,
    help: "Use your full email address and its mailbox password. If your GoDaddy email is Microsoft 365, pick “Outlook / Microsoft 365” instead.",
    passwordSteps: ["Use the mailbox's normal password — the one you use at email.secureserver.net."],
    passwordLink: null,
    needsAppPassword: false,
  },
  {
    key: "gmail",
    label: "Gmail / Google Workspace (app password)",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    spfInclude: "include:_spf.google.com",
    dkimSelectors: ["google"],
    suggestedDailyLimit: 150,
    help: "Turn on 2-step verification for the Google account, then create an app password at myaccount.google.com/apppasswords and paste the 16 letters here.",
    passwordSteps: ["Google doesn't accept your normal password here.", "Turn on 2-step verification for this Google account, then create an app password (button below) and paste the 16-letter code."],
    passwordLink: { label: "Create Google app password", url: "https://myaccount.google.com/apppasswords" },
    extraLink: { label: "Turn on 2-step verification", url: "https://myaccount.google.com/signinoptions/twosv" },
    needsAppPassword: true,
  },
  {
    key: "outlook",
    label: "Outlook / Microsoft 365",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    spfInclude: "include:spf.protection.outlook.com",
    dkimSelectors: ["selector1", "selector2"],
    suggestedDailyLimit: 100,
    help: "Microsoft often switches off password sign-in for mail apps. If the test fails, ask your admin to allow “Authenticated SMTP” and IMAP for this mailbox.",
    passwordSteps: ["Microsoft often blocks password sign-in for mail apps. Create an app password if your account has one, or ask your admin to allow “Authenticated SMTP” and IMAP for this mailbox."],
    passwordLink: { label: "Microsoft security settings", url: "https://account.microsoft.com/security" },
    needsAppPassword: false,
  },
  {
    key: "custom",
    label: "Other email host",
    smtpHost: "",
    smtpPort: 465,
    imapHost: "",
    imapPort: 993,
    spfInclude: null,
    dkimSelectors: ["default", "mail", "dkim", "selector1", "s1", "k1"],
    suggestedDailyLimit: 100,
    help: "Your email host lists these as “SMTP” (outgoing) and “IMAP” (incoming) settings. Use port 465 or 587 for sending and 993 for the inbox.",
    passwordSteps: ["Use the mailbox's password. If the account has 2-step sign-in, use an app password from your email host."],
    passwordLink: null,
    needsAppPassword: false,
  },
];

export function providerByKey(key: string | null | undefined): ProviderPreset {
  return PROVIDERS.find((p) => p.key === key) ?? PROVIDERS[PROVIDERS.length - 1]!;
}

/** Guesses the preset from a stored account (used for DNS hints). */
export function presetForAccount(a: { provider: string; provider_label: string; smtp_host: string | null }): ProviderPreset {
  if (a.provider === "gmail_api") return providerByKey("gmail");
  const byLabel = PROVIDERS.find((p) => p.key === a.provider_label);
  if (byLabel) return byLabel;
  const host = (a.smtp_host ?? "").toLowerCase();
  if (host.includes("zoho.in")) return providerByKey("zoho_in");
  if (host.includes("zoho.eu")) return providerByKey("zoho_eu");
  if (host.includes("zoho")) return providerByKey("zoho_com");
  if (host.includes("secureserver")) return providerByKey("godaddy");
  if (host.includes("gmail") || host.includes("google")) return providerByKey("gmail");
  if (host.includes("office365") || host.includes("outlook")) return providerByKey("outlook");
  return providerByKey("custom");
}
