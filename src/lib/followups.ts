// Pure follow-up and sequence rules (safe for the browser and tests).
// campaign_leads.current_step: 1 = first email sent, 2..9 = follow-up 1..8 sent.

export const MAX_FOLLOW_UPS = 8;
export const DELAY_PRESETS = [3, 5, 7, 13, 21] as const;

export type FollowUp = { delay_days: number; body: string };

/** Reads campaigns.follow_ups safely: at most 8 steps, delays 1–365 days, empty steps end the list. */
export function parseFollowUps(raw: unknown): FollowUp[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowUp[] = [];
  for (const s of raw.slice(0, MAX_FOLLOW_UPS)) {
    const body = typeof s?.body === "string" ? s.body : "";
    if (!body.trim()) break;
    const d = Math.round(Number(s?.delay_days));
    out.push({ body, delay_days: Number.isFinite(d) ? Math.min(365, Math.max(1, d)) : 3 });
  }
  return out;
}

/** The next follow-up for a recipient and when it's due, or null when the sequence is finished. */
export function nextFollowUp(
  c: { follow_ups: unknown },
  cl: { current_step: number; last_sent_at: string | null; sequence_stopped_at: string | null },
): { n: number; body: string; dueAt: Date } | null {
  if (cl.sequence_stopped_at || !cl.last_sent_at) return null;
  const steps = parseFollowUps(c.follow_ups);
  const step = steps[cl.current_step - 1];
  if (cl.current_step < 1 || !step) return null;
  const dueAt = new Date(new Date(cl.last_sent_at).getTime() + step.delay_days * 86_400_000);
  return { n: cl.current_step, body: step.body, dueAt };
}

export function stepLabel(step: number, isManual: boolean): string {
  if (isManual) return "Your reply";
  if (step === 99) return "Check-in";
  return step === 0 ? "First email" : `Follow-up ${step}`;
}

// ---- Behaviour rules: what happens after someone replies ----

export type ReplyAction = "stop" | "continue" | "nurture";

export type Behavior = {
  /** Out-of-office replies: keep the sequence going, or stop it. */
  out_of_office: "continue" | "stop";
  /** "Not now / later" replies: send one check-in email after some days. */
  later_check_in: boolean;
  later_delay_days: number;
  later_body: string;
};

export const DEFAULT_BEHAVIOR: Behavior = {
  out_of_office: "continue",
  later_check_in: false,
  later_delay_days: 21,
  later_body: "Hi {{first_name|there}}, circling back as you suggested — is now a better time to talk?",
};

export function parseBehavior(raw: unknown): Behavior {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Behavior>;
  const d = Math.round(Number(o.later_delay_days));
  return {
    out_of_office: o.out_of_office === "stop" ? "stop" : "continue",
    later_check_in: o.later_check_in === true,
    later_delay_days: Number.isFinite(d) ? Math.min(365, Math.max(1, d)) : DEFAULT_BEHAVIOR.later_delay_days,
    later_body: typeof o.later_body === "string" ? o.later_body : DEFAULT_BEHAVIOR.later_body,
  };
}

/**
 * What a reply does to the sequence. Unsubscribes and bounces always stop it.
 * Every real reply stops follow-ups; "later" replies may get one check-in.
 */
export function replyAction(category: string | null, b: Behavior): ReplyAction {
  if (category === "out_of_office") return b.out_of_office === "continue" ? "continue" : "stop";
  if (category === "follow_up_later" && b.later_check_in && b.later_body.trim()) return "nurture";
  return "stop";
}

// ---- Sending window ----

export type SendingWindow = { send_start_hour: number; send_end_hour: number; send_weekdays_only: boolean };

/** True when `now` falls inside the owner's sending hours (in their time zone). */
export function inSendingWindow(now: Date, timeZone: string, w: SendingWindow): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (w.send_weekdays_only && (day === "Sat" || day === "Sun")) return false;
  const start = w.send_start_hour ?? 0;
  const end = w.send_end_hour ?? 24;
  if (start >= end) return true;
  return hour >= start && hour < end;
}
