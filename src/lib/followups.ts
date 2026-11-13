// Pure follow-up rules (safe for the browser and tests).
// campaign_leads.current_step: 1 = first email sent, 2..4 = follow-up 1..3 sent.

export type FollowUpCampaign = {
  follow_up_1_body: string;
  follow_up_1_delay_days: number;
  follow_up_2_body: string;
  follow_up_2_delay_days: number;
  follow_up_3_body: string;
  follow_up_3_delay_days: number;
};

export function followUpStep(c: FollowUpCampaign, n: 1 | 2 | 3) {
  const body = n === 1 ? c.follow_up_1_body : n === 2 ? c.follow_up_2_body : c.follow_up_3_body;
  const delay = n === 1 ? c.follow_up_1_delay_days : n === 2 ? c.follow_up_2_delay_days : c.follow_up_3_delay_days;
  return { n, body, delayDays: delay };
}

/** The next follow-up for a recipient and when it's due, or null when the sequence is finished. */
export function nextFollowUp(
  c: FollowUpCampaign,
  cl: { current_step: number; last_sent_at: string | null; sequence_stopped_at: string | null },
): { n: 1 | 2 | 3; body: string; dueAt: Date } | null {
  if (cl.sequence_stopped_at || !cl.last_sent_at) return null;
  if (cl.current_step < 1 || cl.current_step > 3) return null;
  const step = followUpStep(c, cl.current_step as 1 | 2 | 3);
  if (!step.body.trim()) return null;
  const dueAt = new Date(new Date(cl.last_sent_at).getTime() + step.delayDays * 86_400_000);
  return { n: step.n, body: step.body, dueAt };
}

export function stepLabel(step: number, isManual: boolean): string {
  if (isManual) return "Your reply";
  return step === 0 ? "First email" : `Follow-up ${step}`;
}
