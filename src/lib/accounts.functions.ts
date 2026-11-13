import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type AccountRow = Database["public"]["Tables"]["sending_accounts"]["Row"];

const accountInput = z.object({
  accountId: z.string().uuid().optional(),
  email: z.string().trim().toLowerCase().email().max(254),
  fromName: z.string().trim().max(120).default(""),
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1).max(500),
  // Only when automatic detection couldn't find the servers.
  smtpHost: z.string().trim().max(255).regex(/^[a-z0-9.-]*$/i, "Server name looks wrong").optional(),
  imapHost: z.string().trim().max(255).regex(/^[a-z0-9.-]*$/i, "Server name looks wrong").optional(),
  dailyLimit: z.number().int().min(1).max(2000).default(50),
});

export type ConnectResult =
  | { ok: true; id: string; providerKey: string; warning: string | null }
  | { ok: false; error: string; reason: "password" | "servers" | "other"; providerKey: string };

/** Which email provider an address uses (from its domain's mail records), to show the right steps. */
export const detectMailboxProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(d))
  .handler(async ({ data }) => {
    const { dnsLookup } = await import("./email-verify.server");
    const { detectMailbox } = await import("./mailbox-detect");
    const mx = await dnsLookup(data.email.split("@")[1] ?? "", "MX");
    return { providerKey: detectMailbox(data.email, mx.records).providerKey };
  });

/** Connects a mailbox from just its email and password: finds the servers, signs in, saves it. */
export const saveMailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => accountInput.parse(d))
  .handler(async ({ data, context }): Promise<ConnectResult> => {
    const { smtpVerify } = await import("./smtp.server");
    const { withImap } = await import("./imap.server");
    const { saveAccountPassword } = await import("./credentials.server");
    const { dnsLookup } = await import("./email-verify.server");
    const { detectMailbox, manualCandidates } = await import("./mailbox-detect");
    const { providerByKey } = await import("./providers");
    const { supabase, userId } = context;

    const mx = await dnsLookup(data.email.split("@")[1] ?? "", "MX");
    const detected = detectMailbox(data.email, mx.records);
    const providerKey = data.smtpHost ? "custom" : detected.providerKey;
    const candidates = data.smtpHost
      ? manualCandidates(data.smtpHost.toLowerCase(), (data.imapHost || data.smtpHost).toLowerCase())
      : detected.candidates;
    // Google/Zoho app passwords are shown in groups ("abcd efgh ijkl mnop"); the real code has no spaces.
    const password = /^(gmail|zoho_)/.test(providerKey) ? data.password.replace(/\s+/g, "") : data.password;
    const username = data.username || data.email;
    const preset = providerByKey(providerKey);

    const withTimeout = <T,>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timed out"), { kind: "config" })), ms))]);

    let found: (typeof candidates)[number] | null = null;
    let authError: string | null = null;
    let lastError = "";
    for (const cand of candidates) {
      try {
        await withTimeout(smtpVerify({ host: cand.smtpHost, port: cand.smtpPort, username, password, timeoutMs: 10000 }), 12000);
        found = cand;
        break;
      } catch (e) {
        const err = e as Error & { kind?: string };
        if (err.kind === "auth") authError ??= err.message;
        else lastError = err.message;
      }
    }
    if (!found) {
      if (authError) {
        const { signInHint } = await import("./mail-protocol");
        const hint = signInHint(/^zoho/.test(providerKey) ? "zoho" : providerKey === "gmail" ? "google" : authError);
        return { ok: false, reason: "password", providerKey, error: hint };
      }
      return {
        ok: false,
        reason: "servers",
        providerKey,
        error: data.smtpHost
          ? `Couldn't reach ${data.smtpHost}. Check the server name with your email host. (${lastError})`
          : "We couldn't find this mailbox's mail servers automatically. Enter the server name your email host gives you.",
      };
    }

    // Reading replies: try the inbox too. If it fails, still save — sending works — and say why.
    let warning: string | null = null;
    try {
      await withTimeout(withImap({ host: found.imapHost, port: found.imapPort, username, password }, (s) => s.selectInbox()), 15000);
    } catch (e) {
      warning = /^zoho/.test(providerKey)
        ? "Sending works, but replies can't be read yet: turn on IMAP in Zoho Mail (Settings → Mail Accounts → IMAP), then click Test on this account."
        : `Sending works, but replies can't be read yet (${(e as Error).message}). Click Test on this account after fixing it.`;
    }

    const fields = {
      provider: "smtp",
      provider_label: providerKey,
      email: data.email,
      from_name: data.fromName,
      username,
      smtp_host: found.smtpHost,
      smtp_port: found.smtpPort,
      imap_host: found.imapHost,
      imap_port: found.imapPort,
      status: "active",
      last_error: warning,
      last_checked_at: new Date().toISOString(),
    };
    let id = data.accountId;
    if (id) {
      const { error } = await supabase.from("sending_accounts").update({ ...fields, imap_last_uid: null, imap_uidvalidity: null }).eq("id", id);
      if (error) return { ok: false, reason: "other", providerKey, error: error.message };
    } else {
      const { data: row, error } = await supabase
        .from("sending_accounts")
        .insert({ ...fields, owner_id: userId, secret_name: `smtp:${data.email}`, daily_limit: data.dailyLimit || preset.suggestedDailyLimit })
        .select("id")
        .single();
      if (error || !row)
        return { ok: false, reason: "other", providerKey, error: error?.code === "23505" ? "This email is already added." : (error?.message ?? "Couldn't save") };
      id = row.id;
    }
    await saveAccountPassword(id, userId, password);
    return { ok: true, id, providerKey, warning };
  });

export const testSendingAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { testAccountConnection } = await import("./mailer.server");
    const { supabase } = context;
    const { data: account } = await supabase.from("sending_accounts").select("*").eq("id", data.accountId).single();
    if (!account) throw new Error("Account not found");
    try {
      const r = await testAccountConnection(account);
      await supabase
        .from("sending_accounts")
        .update({ status: account.status === "error" ? "active" : account.status, last_error: null, last_checked_at: new Date().toISOString() })
        .eq("id", account.id);
      return { ok: true as const, ...r };
    } catch (e) {
      const message = (e as Error).message;
      await supabase.from("sending_accounts").update({ status: "error", last_error: message, last_checked_at: new Date().toISOString() }).eq("id", account.id);
      return { ok: false as const, error: message };
    }
  });

export const removeSendingAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: campaigns } = await supabase.from("campaigns").select("id, account_ids").contains("account_ids", [data.accountId]);
    for (const c of campaigns ?? []) {
      await supabase.from("campaigns").update({ account_ids: c.account_ids.filter((x) => x !== data.accountId) }).eq("id", c.id);
    }
    const { error } = await supabase.from("sending_accounts").delete().eq("id", data.accountId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Looks up SPF, DKIM, DMARC and MX for the account's domain and saves the result. */
export const checkAccountDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ accountId: z.string().uuid(), selector: z.string().trim().max(63).regex(/^[a-z0-9._-]*$/i).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { checkDomainHealth } = await import("./email-verify.server");
    const { presetForAccount } = await import("./providers");
    const { supabase } = context;
    const { data: account } = await supabase.from("sending_accounts").select("*").eq("id", data.accountId).single();
    if (!account) throw new Error("Account not found");
    const selector = data.selector !== undefined ? data.selector || null : account.dkim_selector;
    const preset = presetForAccount(account);
    const health = await checkDomainHealth(account.email, preset.spfInclude, [...(selector ? [selector] : []), ...preset.dkimSelectors]);
    await supabase
      .from("sending_accounts")
      .update({ dns_check: health as never, dns_checked_at: health.checkedAt, dkim_selector: selector })
      .eq("id", account.id);
    return health;
  });

/** Checks lead email addresses (format, throwaway domains, mail server) before sending. */
export const verifyLeadEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leadIds: z.array(z.string().uuid()).max(500).optional(), recheck: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { verifyEmailAddress } = await import("./email-verify.server");
    const { supabase } = context;
    let q = supabase.from("leads").select("id, email").limit(300);
    if (data.leadIds?.length) q = q.in("id", data.leadIds);
    if (!data.recheck) q = q.eq("email_check", "unchecked");
    const { data: leads, error } = await q;
    if (error) throw new Error(error.message);
    const counts = { valid: 0, risky: 0, invalid: 0 };
    const list = leads ?? [];
    for (let i = 0; i < list.length; i += 10) {
      await Promise.all(
        list.slice(i, i + 10).map(async (l) => {
          const r = await verifyEmailAddress(l.email);
          counts[r.result]++;
          await supabase
            .from("leads")
            .update({ email_check: r.result, email_check_reason: r.reason, email_checked_at: new Date().toISOString() })
            .eq("id", l.id);
        }),
      );
    }
    const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("email_check", "unchecked");
    return { checked: list.length, ...counts, remaining: count ?? 0 };
  });
