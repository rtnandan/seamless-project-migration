import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfDayInTimeZone } from "./sending-rules";

export type LeadsSearch = {
  q?: string | undefined;
  status?: string | undefined;
  sort?: "newest" | "oldest" | "name" | "company" | "last_contacted" | undefined;
  page?: number | undefined;
};

export const PAGE_SIZE = 50;

function ok<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data == null) throw new Error("Not found");
  return res.data as NonNullable<T>;
}

function okMaybe<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export const dashboardQuery = () =>
  queryOptions({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const stats = ok(await supabase.rpc("get_dashboard_stats")) as Record<string, number> & {
        by_status: Record<string, number>;
      };
      return stats;
    },
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: ["settings"],
    queryFn: async () => okMaybe(await supabase.from("app_settings").select("*").maybeSingle()),
  });

export const accountsQuery = () =>
  queryOptions({
    queryKey: ["accounts"],
    queryFn: async () => {
      const accounts = ok(await supabase.from("sending_accounts").select("*").order("created_at"));
      const settings = okMaybe(await supabase.from("app_settings").select("timezone").maybeSingle());
      const since = startOfDayInTimeZone(new Date(), settings?.timezone ?? "Asia/Kolkata");
      const counts = ok(await supabase.rpc("get_sent_counts_since", { _since: since.toISOString() }));
      const sentToday = new Map<string, number>();
      for (const c of counts ?? []) {
        if (c.sending_account_id)
          sentToday.set(c.sending_account_id, (sentToday.get(c.sending_account_id) ?? 0) + Number(c.n));
      }
      return accounts.map((a) => ({ ...a, sent_today: sentToday.get(a.id) ?? 0 }));
    },
  });

export const leadsQuery = (s: LeadsSearch) =>
  queryOptions({
    queryKey: ["leads", s],
    queryFn: async () => {
      const page = Math.max(1, s.page ?? 1);
      let q = supabase.from("leads").select("*", { count: "exact" });
      if (s.status) q = q.eq("status", s.status);
      if (s.q?.trim()) {
        const term = s.q.trim().replace(/[%,()]/g, " ");
        q = q.or(
          `email.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%,designation.ilike.%${term}%,industry.ilike.%${term}%`,
        );
      }
      switch (s.sort) {
        case "oldest":
          q = q.order("created_at", { ascending: true });
          break;
        case "name":
          q = q.order("first_name").order("last_name");
          break;
        case "company":
          q = q.order("company");
          break;
        case "last_contacted":
          q = q.order("last_contacted_at", { ascending: false, nullsFirst: false });
          break;
        default:
          q = q.order("created_at", { ascending: false });
      }
      const from = (page - 1) * PAGE_SIZE;
      const res = await q.range(from, from + PAGE_SIZE - 1);
      if (res.error) throw new Error(res.error.message);
      return { rows: res.data, total: res.count ?? 0, page };
    },
  });

export const leadQuery = (id: string) =>
  queryOptions({
    queryKey: ["lead", id],
    queryFn: async () => {
      const lead = ok(await supabase.from("leads").select("*").eq("id", id).single());
      const messages = ok(
        await supabase
          .from("email_messages")
          .select("*, campaigns(name)")
          .eq("lead_id", id)
          .order("created_at", { ascending: false }),
      );
      const enrolments = ok(
        await supabase.from("campaign_leads").select("*, campaigns(id, name, status)").eq("lead_id", id),
      );
      return { lead, messages, enrolments };
    },
  });

async function fetchCampaigns(id?: string) {
  let q = supabase.from("campaigns").select("*").order("created_at", { ascending: false });
  if (id) q = q.eq("id", id);
  const campaigns = ok(await q);
  const stats = ok(await supabase.rpc("get_campaign_stats"));
  const byId = new Map((stats ?? []).map((s) => [s.campaign_id, s]));
  return campaigns.map((c) => {
    const s = byId.get(c.id);
    return {
      ...c,
      stats: {
        total: Number(s?.total ?? 0),
        queued: Number(s?.queued ?? 0),
        sending: Number(s?.sending ?? 0),
        sent: Number(s?.sent ?? 0),
        failed: Number(s?.failed ?? 0),
        skipped: Number(s?.skipped ?? 0),
      },
    };
  });
}

export type CampaignWithStats = Awaited<ReturnType<typeof fetchCampaigns>>[number];

export const campaignsQuery = () =>
  queryOptions({ queryKey: ["campaigns"], queryFn: () => fetchCampaigns() });

export const campaignQuery = (id: string) =>
  queryOptions({
    queryKey: ["campaign", id],
    queryFn: async () => {
      const [c] = await fetchCampaigns(id);
      if (!c) throw new Error("Campaign not found");
      return c;
    },
  });

export const campaignRecipientsQuery = (id: string, status?: string) =>
  queryOptions({
    queryKey: ["campaign-recipients", id, status ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("campaign_leads")
        .select("*, leads(id, email, first_name, last_name, company, designation, industry, status, custom_fields)")
        .eq("campaign_id", id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (status) q = q.eq("status", status);
      return ok(await q);
    },
  });

export const recentActivityQuery = () =>
  queryOptions({
    queryKey: ["recent-activity"],
    queryFn: async () =>
      ok(
        await supabase
          .from("email_messages")
          .select("id, to_email, from_email, direction, subject, status, sent_at, created_at, is_test, error, lead_id, campaigns(name)")
          .order("created_at", { ascending: false })
          .limit(8),
      ),
  });

export const suppressionsQuery = () =>
  queryOptions({
    queryKey: ["suppressions"],
    queryFn: async () =>
      ok(await supabase.from("suppressions").select("*").order("created_at", { ascending: false }).limit(1000)),
  });

export type InboxSearch = { filter?: string | undefined; campaign?: string | undefined; thread?: string | undefined };

export const inboxThreadsQuery = (s: Pick<InboxSearch, "filter" | "campaign">) =>
  queryOptions({
    queryKey: ["inbox", s.filter ?? "all", s.campaign ?? "all"],
    queryFn: async () =>
      ok(
        await supabase.rpc("get_inbox_threads", {
          ...(s.filter ? { _filter: s.filter } : {}),
          ...(s.campaign ? { _campaign_id: s.campaign } : {}),
          _limit: 300,
        }),
      ),
  });

export const threadQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["thread", threadId],
    queryFn: async () =>
      ok(
        await supabase
          .from("email_messages")
          .select("id, direction, is_manual, step, from_email, to_email, cc, subject, body, status, error, sent_at, created_at, reply_category, reply_summary, lead_id, campaign_id, sending_account_id, read_at, campaigns(name)")
          .eq("gmail_thread_id", threadId)
          .eq("is_test", false)
          .order("created_at", { ascending: true }),
      ),
  });

export const campaignNamesQuery = () =>
  queryOptions({
    queryKey: ["campaign-names"],
    queryFn: async () => ok(await supabase.from("campaigns").select("id, name").order("created_at", { ascending: false })),
  });

export type SentSearch = { campaign?: string | undefined; kind?: string | undefined; account?: string | undefined; page?: number | undefined };
export const SENT_PAGE = 50;

export const sentQuery = (s: SentSearch) =>
  queryOptions({
    queryKey: ["sent", s],
    queryFn: async () => {
      const page = Math.max(1, s.page ?? 1);
      let q = supabase
        .from("email_messages")
        .select("id, to_email, cc, from_email, subject, body, status, error, step, is_manual, sent_at, created_at, gmail_thread_id, lead_id, campaigns(name), leads(first_name, last_name, company)", { count: "exact" })
        .eq("direction", "outbound")
        .eq("is_test", false)
        .in("status", ["sent", "bounced", "failed"])
        .order("created_at", { ascending: false });
      if (s.campaign) q = q.eq("campaign_id", s.campaign);
      if (s.account) q = q.eq("sending_account_id", s.account);
      if (s.kind === "first") q = q.eq("step", 0).eq("is_manual", false);
      else if (s.kind === "follow_up") q = q.gt("step", 0);
      else if (s.kind === "manual") q = q.eq("is_manual", true);
      const from = (page - 1) * SENT_PAGE;
      const res = await q.range(from, from + SENT_PAGE - 1);
      if (res.error) throw new Error(res.error.message);
      return { rows: res.data, total: res.count ?? 0, page };
    },
  });

export const upcomingFollowUpsQuery = () =>
  queryOptions({
    queryKey: ["follow-ups-upcoming"],
    queryFn: async () =>
      ok(
        await supabase
          .from("campaign_leads")
          .select(
            "id, current_step, last_sent_at, sequence_stopped_at, gmail_thread_id, campaign_id, leads(id, email, first_name, last_name, company, status), campaigns!inner(id, name, status, follow_up_1_body, follow_up_1_delay_days, follow_up_2_body, follow_up_2_delay_days, follow_up_3_body, follow_up_3_delay_days), sending_accounts(email)",
          )
          .eq("status", "sent")
          .gte("current_step", 1)
          .lte("current_step", 3)
          .is("sequence_stopped_at", null)
          .order("last_sent_at", { ascending: true })
          .limit(500),
      ),
  });
