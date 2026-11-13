import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled: looks for bounce notices and new replies in every connected Gmail inbox.
export const Route = createFileRoute("/api/public/jobs/check-inbox")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { processBounces } = await import("@/lib/bounces.server");
          const { syncReplies } = await import("@/lib/replies.server");
          const bounces = await processBounces(supabaseAdmin);
          const replies = await syncReplies(supabaseAdmin);
          // Close conversations with no activity for each owner's "auto-close after" days.
          const { data: closed } = await supabaseAdmin.rpc("close_inactive_conversations");
          return Response.json({ ok: true, bounced: bounces.bounced, closed: closed ?? 0, ...replies, notes: [...bounces.notes, ...replies.notes] });
        } catch (e) {
          console.error("check-inbox failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
