// Server-only sending engine. Used by the scheduled job (all owners, admin client)
// and by the "Send next batch now" button (one owner, RLS client).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { DO_NOT_EMAIL_STATUSES } from "./email-utils";
import { composeEmail, pickSignature } from "./compose";
import { parseAttachments } from "./attachments";
import { assignAccounts, MANUAL_BATCH_SIZE, remainingAllowance, SENDS_PER_RUN, startOfDayInTimeZone } from "./sending-rules";
import { GmailError } from "./gmail.server";
import { sendFromAccount } from "./mailer.server";
import { inSendingWindow, nextFollowUp, parseBehavior, parseFollowUps, replyAction } from "./followups";
import { replySubject } from "./mime";

type DB = SupabaseClient<Database>;

export type RunResult = { sent: number; skipped: number; failed: number; notes: string[] };

export async function runSender(db: DB, opts: { ownerId?: string; maxSends?: number } = {}): Promise<RunResult> {
  const result: RunResult = { sent: 0, skipped: 0, failed: 0, notes: [] };
  let slots = Math.min(opts.maxSends ?? SENDS_PER_RUN, MANUAL_BATCH_SIZE);
  const now = new Date();

  // 1. Anything stuck "sending" for 15+ minutes is marked failed, never retried (avoids duplicates).
  {
    let q = db
      .from("campaign_leads")
      .update({ status: "failed", error: "Interrupted while sending. Not retried to avoid a duplicate email." })
      .eq("status", "sending")
      .lt("claimed_at", new Date(now.getTime() - 15 * 60_000).toISOString());
    if (opts.ownerId) q = q.eq("owner_id", opts.ownerId);
    await q;
  }

  // 2. Active, approved campaigns.
  let cq = db
    .from("campaigns")
    .select("*")
    .eq("status", "active")
    .not("approved_at", "is", null)
    .order("started_at", { ascending: true });
  if (opts.ownerId) cq = cq.eq("owner_id", opts.ownerId);
  const { data: allCampaigns, error: cErr } = await cq;
  if (cErr) throw new Error(cErr.message);
  if (!allCampaigns?.length) return result;

  const allOwners = [...new Set(allCampaigns.map((c) => c.owner_id))];
  const { data: settingsRows } = await db.from("app_settings").select("*").in("owner_id", allOwners);
  const settings = new Map((settingsRows ?? []).map((s) => [s.owner_id, s]));
  // Each owner's sending hours (Settings) decide whether anything goes out right now.
  const campaigns = allCampaigns.filter((c) => {
    const s = settings.get(c.owner_id);
    return !s || inSendingWindow(now, s.timezone || "Asia/Kolkata", s);
  });
  if (!campaigns.length) {
    result.notes.push("Outside your sending hours");
    return result;
  }
  const ownerIds = [...new Set(campaigns.map((c) => c.owner_id))];

  const { data: accountsRows } = await db.from("sending_accounts").select("*").in("owner_id", ownerIds);
  const accounts = new Map((accountsRows ?? []).map((a) => [a.id, a]));

  // Accounts paused for hitting their provider's limit come back the next day.
  for (const a of accounts.values()) {
    const tz = settings.get(a.owner_id)?.timezone ?? "Asia/Kolkata";
    if (a.status === "rate_limited" && new Date(a.updated_at) < startOfDayInTimeZone(now, tz)) {
      await db.from("sending_accounts").update({ status: "active", last_error: null }).eq("id", a.id);
      a.status = "active";
    }
  }

  // Sent-today counts, using the earliest day start among owners (filtered precisely below).
  const dayStartByOwner = new Map(
    ownerIds.map((o) => [o, startOfDayInTimeZone(now, settings.get(o)?.timezone ?? "Asia/Kolkata")]),
  );
  const earliest = new Date(Math.min(...[...dayStartByOwner.values()].map((d) => d.getTime())));
  const { data: sentRows } = await db
    .from("email_messages")
    .select("sending_account_id, campaign_id, sent_at, owner_id")
    .eq("direction", "outbound")
    .in("status", ["sent", "bounced"])
    .gte("sent_at", earliest.toISOString())
    .in("owner_id", ownerIds)
    .limit(20000);
  const accountSent = new Map<string, number>();
  const campaignSent = new Map<string, number>();
  for (const r of sentRows ?? []) {
    const start = dayStartByOwner.get(r.owner_id);
    if (!start || !r.sent_at || new Date(r.sent_at) < start) continue;
    if (r.sending_account_id) accountSent.set(r.sending_account_id, (accountSent.get(r.sending_account_id) ?? 0) + 1);
    if (r.campaign_id) campaignSent.set(r.campaign_id, (campaignSent.get(r.campaign_id) ?? 0) + 1);
  }

  type Task = { campaign: (typeof campaigns)[number]; clId: string; accountId: string };
  const tasks: Task[] = [];

  for (const campaign of campaigns) {
    if (slots <= 0) break;
    const usable = (campaign.account_ids ?? [])
      .map((id) => accounts.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a && a.status === "active");
    if (!usable.length) {
      result.notes.push(`${campaign.name}: no active sending account`);
      continue;
    }
    const campaignRemaining = remainingAllowance({
      accountDailyLimit: Number.MAX_SAFE_INTEGER,
      accountSentToday: 0,
      campaignDailyLimit: campaign.daily_limit,
      campaignSentToday: campaignSent.get(campaign.id) ?? 0,
      slotsThisRun: slots,
    });
    if (campaignRemaining <= 0) continue;
    const perAccount = usable.map((a) => ({
      id: a.id,
      remaining: remainingAllowance({
        accountDailyLimit: a.daily_limit,
        accountSentToday: accountSent.get(a.id) ?? 0,
        campaignDailyLimit: Number.MAX_SAFE_INTEGER,
        campaignSentToday: 0,
        slotsThisRun: slots,
      }),
    }));
    const plan = assignAccounts(perAccount, campaignRemaining);
    if (!plan.length) {
      result.notes.push(`${campaign.name}: daily account limit reached`);
      continue;
    }

    const { data: queued } = await db
      .from("campaign_leads")
      .select("id")
      .eq("campaign_id", campaign.id)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(plan.length);
    if (!queued?.length) {
      const { count } = await db
        .from("campaign_leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .in("status", ["queued", "sending"]);
      if (!count) {
        await db.from("campaigns").update({ status: "completed", completed_at: now.toISOString() }).eq("id", campaign.id);
      }
      continue;
    }

    // Claim each row atomically: only rows still "queued" move to "sending".
    for (let i = 0; i < queued.length; i++) {
      const accountId = plan[i];
      const row = queued[i];
      if (!accountId || !row) continue;
      const { data: claimed } = await db
        .from("campaign_leads")
        .update({ status: "sending", claimed_at: new Date().toISOString(), sending_account_id: accountId })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id");
      if (claimed?.length) {
        tasks.push({ campaign, clId: row.id, accountId });
        accountSent.set(accountId, (accountSent.get(accountId) ?? 0) + 1);
        campaignSent.set(campaign.id, (campaignSent.get(campaign.id) ?? 0) + 1);
        slots--;
      }
    }
  }

  // 3. Send one at a time (a steady pace looks natural to inbox providers).
  for (const t of tasks) {
    const account = accounts.get(t.accountId);
    if (!account) {
      await db
        .from("campaign_leads")
        .update({ status: "failed", error: "Sending account is no longer available." })
        .eq("id", t.clId)
        .eq("status", "sending");
      result.failed++;
      continue;
    }
    if (account.status !== "active") {
      await db
        .from("campaign_leads")
        .update({ status: "queued", claimed_at: null, sending_account_id: null })
        .eq("id", t.clId)
        .eq("status", "sending");
      continue;
    }
    const outcome = await sendOne(db, t.campaign, t.clId, account, settings.get(t.campaign.owner_id));
    result[outcome]++;
  }

  // 4. Follow-ups that are due, sent in the same conversation from the same account.
  if (slots > 0) {
    const fu = await sendDueFollowUps(db, campaigns, accounts, accountSent, settings, slots, now);
    result.sent += fu.sent;
    result.skipped += fu.skipped;
    result.failed += fu.failed;
    result.notes.push(...fu.notes);
    slots -= fu.sent + fu.failed;
  }

  // 5. One check-in for people who said "not now, later" (when the campaign's rule is on).
  if (slots > 0) {
    const ci = await sendCheckIns(db, campaigns, accounts, accountSent, settings, slots, now);
    result.sent += ci.sent;
    result.failed += ci.failed;
  }
  return result;
}

type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];
type Account = Database["public"]["Tables"]["sending_accounts"]["Row"];
type Settings = Database["public"]["Tables"]["app_settings"]["Row"];

/** Checks the address before the first email; remembers the result on the lead. */
async function addressProblem(db: DB, lead: { id: string; email: string; email_check: string; email_check_reason: string | null }) {
  if (lead.email_check === "invalid") return lead.email_check_reason ?? "Email address failed the check";
  if (lead.email_check !== "unchecked") return null;
  const { verifyEmailAddress } = await import("./email-verify.server");
  const check = await verifyEmailAddress(lead.email);
  await db
    .from("leads")
    .update({ email_check: check.result, email_check_reason: check.reason, email_checked_at: new Date().toISOString() })
    .eq("id", lead.id);
  return check.result === "invalid" ? check.reason : null;
}

async function sendDueFollowUps(
  db: DB,
  campaigns: Campaign[],
  accounts: Map<string, Account>,
  accountSent: Map<string, number>,
  settings: Map<string, Settings>,
  slots: number,
  now: Date,
) {
  const out = { sent: 0, skipped: 0, failed: 0, notes: [] as string[] };
  const withFollowUps = campaigns.filter((c) => parseFollowUps(c.follow_ups).length > 0);
  if (!withFollowUps.length) return out;
  const byId = new Map(withFollowUps.map((c) => [c.id, c]));
  const { data: rows } = await db
    .from("campaign_leads")
    .select("id, campaign_id, lead_id, owner_id, current_step, last_sent_at, sequence_stopped_at, sequence_claimed_at, sending_account_id, gmail_thread_id")
    .in("campaign_id", [...byId.keys()])
    .eq("status", "sent")
    .gte("current_step", 1)
    .lte("current_step", 8)
    .is("sequence_stopped_at", null)
    .lt("last_sent_at", new Date(now.getTime() - 86_400_000).toISOString())
    .order("last_sent_at", { ascending: true })
    .limit(200);

  for (const cl of rows ?? []) {
    if (slots <= 0) break;
    const campaign = byId.get(cl.campaign_id);
    if (!campaign) continue;
    const next = nextFollowUp(campaign, cl);
    const behavior = parseBehavior(campaign.behavior);
    if (!next || next.dueAt > now) continue;
    const account = cl.sending_account_id ? accounts.get(cl.sending_account_id) : undefined;
    if (!account || account.status !== "active") continue;
    if ((accountSent.get(account.id) ?? 0) >= account.daily_limit) continue;
    if (cl.sequence_claimed_at && new Date(cl.sequence_claimed_at) > new Date(now.getTime() - 15 * 60_000)) continue;

    // Claim so two runs never send the same follow-up.
    const { data: claimed } = await db
      .from("campaign_leads")
      .update({ sequence_claimed_at: new Date().toISOString(), sequence_claimed_step: next.n })
      .eq("id", cl.id)
      .eq("current_step", cl.current_step)
      .is("sequence_stopped_at", null)
      .select("id");
    if (!claimed?.length) continue;
    slots--;
    accountSent.set(account.id, (accountSent.get(account.id) ?? 0) + 1);
    const release = (patch: Database["public"]["Tables"]["campaign_leads"]["Update"] = {}) =>
      db.from("campaign_leads").update({ sequence_claimed_at: null, sequence_claimed_step: null, ...patch }).eq("id", cl.id);

    const { data: lead } = await db.from("leads").select("*").eq("id", cl.lead_id).single();
    const { data: history } = await db
      .from("email_messages")
      .select("direction, subject, rfc_message_id, gmail_thread_id, status, reply_category")
      .eq("campaign_lead_id", cl.id)
      .order("created_at", { ascending: true });
    const stopReason = !lead
      ? "Lead removed"
      : DO_NOT_EMAIL_STATUSES.includes(lead.status)
        ? `Lead is ${lead.status}`
        : (history ?? []).some((h) => h.direction === "inbound" && replyAction(h.reply_category, behavior) !== "continue")
          ? "They replied"
          : (history ?? []).some((h) => h.status === "bounced")
            ? "Bounced"
            : null;
    const { data: sup } = lead
      ? await db.from("suppressions").select("id").eq("owner_id", lead.owner_id).eq("email", lead.email).maybeSingle()
      : { data: null };
    if (stopReason || sup || !lead) {
      await release({ sequence_stopped_at: new Date().toISOString(), error: stopReason ?? "On suppression list" });
      out.skipped++;
      continue;
    }

    const first = (history ?? []).find((h) => h.direction === "outbound");
    const refs = (history ?? []).map((h) => h.rfc_message_id).filter((x): x is string => !!x);
    const { body } = composeEmail({
      subject: "",
      body: next.body,
      signature: pickSignature(account.signature, settings.get(campaign.owner_id)?.signature),
      lead: { ...lead, custom_fields: (lead.custom_fields ?? {}) as Record<string, unknown> },
      optOut: false,
    });
    const subject = replySubject(first?.subject || campaign.subject);
    const { data: msg, error: insErr } = await db
      .from("email_messages")
      .insert({
        owner_id: lead.owner_id,
        lead_id: lead.id,
        campaign_id: campaign.id,
        campaign_lead_id: cl.id,
        step: next.n,
        sending_account_id: account.id,
        to_email: lead.email,
        from_email: account.email,
        subject,
        body,
        status: "pending",
        in_reply_to: refs[refs.length - 1] ?? null,
        gmail_thread_id: cl.gmail_thread_id,
      })
      .select("id")
      .single();
    if (insErr || !msg) {
      // Already sent this step (duplicate prevented): move the sequence on.
      await release({ current_step: cl.current_step + 1 });
      out.skipped++;
      continue;
    }
    try {
      const sent = await sendFromAccount(account, {
        to: lead.email,
        subject,
        body,
        inReplyTo: refs[refs.length - 1],
        references: refs,
        threadKey: cl.gmail_thread_id,
      });
      const sentAt = new Date().toISOString();
      await db
        .from("email_messages")
        .update({ status: "sent", sent_at: sentAt, rfc_message_id: sent.rfcMessageId, gmail_message_id: sent.providerMessageId, gmail_thread_id: sent.threadKey })
        .eq("id", msg.id);
      await release({ current_step: cl.current_step + 1, last_sent_at: sentAt, gmail_thread_id: sent.threadKey, error: null });
      await db.from("leads").update({ last_contacted_at: sentAt }).eq("id", lead.id);
      out.sent++;
    } catch (e) {
      const err = e instanceof GmailError ? e : new GmailError(String((e as Error)?.message ?? e), 0, "other");
      await db.from("email_messages").update({ status: "failed", error: err.message }).eq("id", msg.id);
      await release({ sequence_stopped_at: new Date().toISOString(), error: `Follow-up ${next.n} failed: ${err.message}` });
      await markAccountError(db, account, err);
      out.failed++;
    }
  }
  return out;
}

async function markAccountError(db: DB, account: Account, err: GmailError) {
  if (err.kind === "auth" || err.kind === "config") {
    await db.from("sending_accounts").update({ status: "error", last_error: err.message }).eq("id", account.id);
    account.status = "error";
  } else if (err.kind === "rate_limit") {
    await db.from("sending_accounts").update({ status: "rate_limited", last_error: err.message }).eq("id", account.id);
    account.status = "rate_limited";
  }
}

async function sendOne(
  db: DB,
  campaign: Database["public"]["Tables"]["campaigns"]["Row"],
  clId: string,
  account: Database["public"]["Tables"]["sending_accounts"]["Row"],
  settings: Database["public"]["Tables"]["app_settings"]["Row"] | undefined,
): Promise<"sent" | "skipped" | "failed"> {
  const { data: cl } = await db.from("campaign_leads").select("*, leads(*)").eq("id", clId).single();
  const lead = cl?.leads;
  if (!cl || !lead) return "skipped";

  const skip = async (reason: string) => {
    await db.from("campaign_leads").update({ status: "skipped", error: reason }).eq("id", clId);
    return "skipped" as const;
  };
  if (DO_NOT_EMAIL_STATUSES.includes(lead.status)) return skip(`Lead is ${lead.status}`);
  const { data: sup } = await db
    .from("suppressions")
    .select("id")
    .eq("owner_id", lead.owner_id)
    .eq("email", lead.email)
    .maybeSingle();
  if (sup) return skip("On suppression list");
  const problem = await addressProblem(db, lead);
  if (problem) return skip(`Email check: ${problem}`);

  const attachments = parseAttachments(campaign.attachments);
  const { subject, body } = composeEmail({
    subject: campaign.subject,
    body: campaign.body,
    signature: pickSignature(account.signature, settings?.signature),
    lead: { ...lead, custom_fields: (lead.custom_fields ?? {}) as Record<string, unknown> },
    optOut: true,
    attachments,
  });

  // The unique (campaign_lead_id, step) index makes a second insert impossible -> no duplicates.
  const { data: msg, error: insErr } = await db
    .from("email_messages")
    .insert({
      owner_id: lead.owner_id,
      lead_id: lead.id,
      campaign_id: campaign.id,
      campaign_lead_id: clId,
      step: 0,
      sending_account_id: account.id,
      to_email: lead.email,
      from_email: account.email,
      subject,
      body,
      status: "pending",
      attachments: attachments as unknown as Json,
    })
    .select("id")
    .single();
  if (insErr || !msg) return skip("Already sent (duplicate prevented)");

  try {
    const { loadAttachmentFiles } = await import("./attachments.server");
    const files = await loadAttachmentFiles(db, attachments, campaign.owner_id);
    const sent = await sendFromAccount(account, { to: lead.email, subject, body, attachments: files });
    const sentAt = new Date().toISOString();
    await db
      .from("email_messages")
      .update({ status: "sent", sent_at: sentAt, gmail_message_id: sent.providerMessageId, gmail_thread_id: sent.threadKey, rfc_message_id: sent.rfcMessageId })
      .eq("id", msg.id);
    await db
      .from("campaign_leads")
      .update({ status: "sent", sent_at: sentAt, last_sent_at: sentAt, current_step: 1, gmail_thread_id: sent.threadKey, error: null })
      .eq("id", clId);
    await db.from("leads").update({ last_contacted_at: sentAt }).eq("id", lead.id);
    await db.from("leads").update({ status: "email_sent" }).eq("id", lead.id).eq("status", "not_contacted");
    return "sent";
  } catch (e) {
    const err = e instanceof GmailError ? e : new GmailError(String((e as Error)?.message ?? e), 0, "other");
    await db.from("email_messages").update({ status: "failed", error: err.message }).eq("id", msg.id);
    await db.from("campaign_leads").update({ status: "failed", error: err.message }).eq("id", clId);
    await markAccountError(db, account, err);
    return "failed";
  }
}

/** Check-in step number in email_messages (keeps it apart from follow-ups 1–8). */
export const CHECK_IN_STEP = 99;

async function sendCheckIns(
  db: DB,
  campaigns: Campaign[],
  accounts: Map<string, Account>,
  accountSent: Map<string, number>,
  settings: Map<string, Settings>,
  slots: number,
  now: Date,
) {
  const out = { sent: 0, failed: 0 };
  const eligible = campaigns.filter((c) => {
    const b = parseBehavior(c.behavior);
    return b.later_check_in && b.later_body.trim();
  });
  if (!eligible.length) return out;
  const byId = new Map(eligible.map((c) => [c.id, c]));
  const { data: rows } = await db
    .from("campaign_leads")
    .select("id, campaign_id, lead_id, sending_account_id, gmail_thread_id")
    .in("campaign_id", [...byId.keys()])
    .not("sequence_stopped_at", "is", null)
    .is("nurture_sent_at", null)
    .limit(200);
  for (const cl of rows ?? []) {
    if (slots <= 0) break;
    const campaign = byId.get(cl.campaign_id);
    if (!campaign) continue;
    const b = parseBehavior(campaign.behavior);
    const { data: msgs } = await db
      .from("email_messages")
      .select("direction, subject, rfc_message_id, reply_category, sent_at, created_at")
      .eq("campaign_lead_id", cl.id)
      .order("created_at", { ascending: true });
    const inbound = (msgs ?? []).filter((m) => m.direction === "inbound");
    const lastIn = inbound[inbound.length - 1];
    // Only when every reply so far is a "later" (or out-of-office) reply.
    if (!lastIn || lastIn.reply_category !== "follow_up_later") continue;
    if (inbound.some((m) => m.reply_category !== "follow_up_later" && m.reply_category !== "out_of_office")) continue;
    const at = new Date(lastIn.sent_at ?? lastIn.created_at);
    if (at.getTime() + b.later_delay_days * 86_400_000 > now.getTime()) continue;
    const account = cl.sending_account_id ? accounts.get(cl.sending_account_id) : undefined;
    if (!account || account.status !== "active" || (accountSent.get(account.id) ?? 0) >= account.daily_limit) continue;
    const { data: lead } = await db.from("leads").select("*").eq("id", cl.lead_id).single();
    if (!lead || DO_NOT_EMAIL_STATUSES.includes(lead.status)) {
      await db.from("campaign_leads").update({ nurture_sent_at: now.toISOString() }).eq("id", cl.id);
      continue;
    }
    // Claim first so two runs never both send it.
    const { data: claimed } = await db
      .from("campaign_leads")
      .update({ nurture_sent_at: new Date().toISOString() })
      .eq("id", cl.id)
      .is("nurture_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    slots--;
    accountSent.set(account.id, (accountSent.get(account.id) ?? 0) + 1);
    const first = (msgs ?? []).find((m) => m.direction === "outbound");
    const refs = (msgs ?? []).map((m) => m.rfc_message_id).filter((x): x is string => !!x);
    const { body } = composeEmail({
      subject: "",
      body: b.later_body,
      signature: pickSignature(account.signature, settings.get(campaign.owner_id)?.signature),
      lead: { ...lead, custom_fields: (lead.custom_fields ?? {}) as Record<string, unknown> },
    });
    const subject = replySubject(first?.subject || campaign.subject);
    const { data: msg, error } = await db
      .from("email_messages")
      .insert({
        owner_id: lead.owner_id,
        lead_id: lead.id,
        campaign_id: campaign.id,
        campaign_lead_id: cl.id,
        step: CHECK_IN_STEP,
        sending_account_id: account.id,
        to_email: lead.email,
        from_email: account.email,
        subject,
        body,
        status: "pending",
        in_reply_to: refs[refs.length - 1] ?? null,
        gmail_thread_id: cl.gmail_thread_id,
      })
      .select("id")
      .single();
    if (error || !msg) continue;
    try {
      const sent = await sendFromAccount(account, { to: lead.email, subject, body, inReplyTo: refs[refs.length - 1], references: refs, threadKey: cl.gmail_thread_id });
      const sentAt = new Date().toISOString();
      await db
        .from("email_messages")
        .update({ status: "sent", sent_at: sentAt, rfc_message_id: sent.rfcMessageId, gmail_message_id: sent.providerMessageId, gmail_thread_id: sent.threadKey })
        .eq("id", msg.id);
      await db.from("leads").update({ last_contacted_at: sentAt }).eq("id", lead.id);
      out.sent++;
    } catch (e) {
      const err = e instanceof GmailError ? e : new GmailError(String((e as Error)?.message ?? e), 0, "other");
      await db.from("email_messages").update({ status: "failed", error: err.message }).eq("id", msg.id);
      await markAccountError(db, account, err);
      out.failed++;
    }
  }
  return out;
}
