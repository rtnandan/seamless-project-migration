import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const AI_LINE_BATCH = 15;

/** Writes a personal opening line ({{ai_line}}) for up to 15 leads at a time. */
export const generateAiLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadIds: z.array(z.string().uuid()).min(1).max(AI_LINE_BATCH), overwrite: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { generateLines } = await import("./copilot.server");
    let q = supabase.from("leads").select("id, first_name, last_name, company, designation, industry, custom_fields, ai_line").in("id", data.leadIds);
    if (!data.overwrite) q = q.is("ai_line", null);
    const { data: leads, error } = await q;
    if (error) throw new Error(error.message);
    if (!leads?.length) return { written: 0, skipped: data.leadIds.length };
    const { data: settings } = await supabase.from("app_settings").select("ai_context").maybeSingle();
    try {
      const lines = await generateLines(
        leads.map((l) => ({ ...l, custom_fields: (l.custom_fields ?? {}) as Record<string, unknown> })),
        settings?.ai_context ?? "",
      );
      const now = new Date().toISOString();
      let written = 0;
      for (const [id, line] of lines) {
        const { error: uErr } = await supabase.from("leads").update({ ai_line: line, ai_line_at: now }).eq("id", id);
        if (!uErr) written++;
      }
      return { written, skipped: data.leadIds.length - written };
    } catch (e) {
      const err = e as Error & { status?: number };
      return { written: 0, skipped: data.leadIds.length, error: err.message, status: err.status ?? 0 };
    }
  });

export const draftWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        brief: z.string().trim().min(5).max(3000),
        kind: z.enum(["email", "follow_up", "reply"]).default("email"),
        tone: z.string().max(100).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { writeCopy } = await import("./copilot.server");
    const { data: settings } = await context.supabase.from("app_settings").select("ai_context").maybeSingle();
    try {
      return { ok: true as const, ...(await writeCopy({ ...data, context: settings?.ai_context ?? "" })) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** Checks each chosen lead's address (format, typos, disposable inboxes, mail server). */
export const verifyLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadIds: z.array(z.string().uuid()).min(1).max(25) }).parse(d))
  .handler(async ({ data, context }) => {
    const { verifyEmailAddress } = await import("./email-verify.server");
    const { data: leads, error } = await context.supabase.from("leads").select("id, email").in("id", data.leadIds);
    if (error) throw new Error(error.message);
    const counts = { valid: 0, risky: 0, invalid: 0 };
    for (const l of leads ?? []) {
      const r = await verifyEmailAddress(l.email);
      counts[r.result as keyof typeof counts]++;
      await context.supabase
        .from("leads")
        .update({ email_check: r.result, email_check_reason: r.reason, email_checked_at: new Date().toISOString() })
        .eq("id", l.id);
    }
    return counts;
  });
