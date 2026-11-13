import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const emailList = z.array(z.string().trim().toLowerCase().email().max(254)).max(10);

/** Reply to one conversation (optionally copying more people). */
export const sendReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        threadId: z.string().min(1).max(500),
        body: z.string().trim().min(1).max(20000),
        cc: emailList.default([]),
        to: z.string().trim().toLowerCase().email().max(254).optional(),
        includeSignature: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendThreadReply } = await import("./inbox.server");
    return sendThreadReply(context.supabase, data);
  });

/** One message sent separately to each chosen conversation ({{first_name}} etc. are filled in per person). */
export const sendBulkReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        threadIds: z.array(z.string().min(1).max(500)).min(1).max(50),
        body: z.string().trim().min(1).max(20000),
        includeSignature: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendThreadReply } = await import("./inbox.server");
    const results: { threadId: string; ok: boolean; error?: string }[] = [];
    for (const threadId of data.threadIds) {
      try {
        await sendThreadReply(context.supabase, { threadId, body: data.body, cc: [], includeSignature: data.includeSignature });
        results.push({ threadId, ok: true });
      } catch (e) {
        results.push({ threadId, ok: false, error: (e as Error).message });
      }
    }
    return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  });

export const markThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ threadId: z.string().min(1).max(500), unread: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("email_messages")
      .update({ read_at: data.unread ? null : new Date().toISOString() })
      .eq("gmail_thread_id", data.threadId)
      .eq("direction", "inbound");
    const { error } = data.unread ? await q : await q.is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
