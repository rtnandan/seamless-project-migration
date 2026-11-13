import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader, formatDateTime } from "@/components/app/page";
import { DeliveryBadge } from "@/components/app/status";
import { nextFollowUp, stepLabel } from "@/lib/followups";
import { accountsQuery, campaignNamesQuery, sentQuery, SENT_PAGE, upcomingFollowUpsQuery, type SentSearch } from "@/lib/queries";

type Search = SentSearch & { tab?: "sent" | "follow-ups" | undefined };

export const Route = createFileRoute("/_authenticated/sent")({
  head: () => ({
    meta: [
      { title: "Sent & follow-ups — DECILE Outreach" },
      { name: "description", content: "Every email sent from every account, and the follow-ups coming up next." },
      { property: "og:title", content: "Sent & follow-ups — DECILE Outreach" },
      { property: "og:description", content: "Every email sent from every account, and the follow-ups coming up next." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    tab: s["tab"] === "follow-ups" ? "follow-ups" : undefined,
    campaign: typeof s["campaign"] === "string" && s["campaign"] ? s["campaign"] : undefined,
    account: typeof s["account"] === "string" && s["account"] ? s["account"] : undefined,
    kind: typeof s["kind"] === "string" && s["kind"] ? s["kind"] : undefined,
    page: Number(s["page"]) > 1 ? Number(s["page"]) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(sentQuery(deps)),
      context.queryClient.ensureQueryData(upcomingFollowUpsQuery()),
      context.queryClient.ensureQueryData(campaignNamesQuery()),
      context.queryClient.ensureQueryData(accountsQuery()),
    ]);
  },
  component: SentPage,
});

function SentPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/sent" });
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }) });
  return (
    <>
      <PageHeader
        eyebrow="Outbox"
        title="Sent & follow-ups"
        description="Everything that went out — first emails, follow-ups and your own replies — and who gets a follow-up next."
      />
      <Tabs value={search.tab ?? "sent"} onValueChange={(v) => set({ tab: v === "follow-ups" ? "follow-ups" : undefined })}>
        <TabsList>
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="follow-ups">Upcoming follow-ups</TabsTrigger>
        </TabsList>
        <TabsContent value="sent" className="mt-6">
          <SentList search={search} set={set} />
        </TabsContent>
        <TabsContent value="follow-ups" className="mt-6">
          <UpcomingFollowUps />
        </TabsContent>
      </Tabs>
    </>
  );
}

function SentList({ search, set }: { search: Search; set: (p: Partial<Search>) => void }) {
  const { data } = useSuspenseQuery(sentQuery(search));
  const { data: campaigns } = useSuspenseQuery(campaignNamesQuery());
  const { data: accounts } = useSuspenseQuery(accountsQuery());
  const [openId, setOpenId] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil(data.total / SENT_PAGE));

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={search.kind ?? "all"} onValueChange={(v) => set({ kind: v === "all" ? undefined : v })}>
          <SelectTrigger className="w-44" aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All emails</SelectItem>
            <SelectItem value="first">First emails</SelectItem>
            <SelectItem value="follow_up">Follow-ups</SelectItem>
            <SelectItem value="manual">My replies</SelectItem>
          </SelectContent>
        </Select>
        <Select value={search.campaign ?? "all"} onValueChange={(v) => set({ campaign: v === "all" ? undefined : v })}>
          <SelectTrigger className="w-56" aria-label="Campaign">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaigns</SelectItem>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={search.account ?? "all"} onValueChange={(v) => set({ account: v === "all" ? undefined : v })}>
          <SelectTrigger className="w-64" aria-label="Sending account">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sending accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="tabular ml-auto self-center text-sm text-muted-foreground">{data.total} emails</span>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="Nothing sent yet">Emails appear here as soon as a campaign sends them.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((m) => {
                const name = m.leads ? [m.leads.first_name, m.leads.last_name].filter(Boolean).join(" ") : "";
                return (
                  <Fragment key={m.id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                      <TableCell className="max-w-48">
                        {m.lead_id ? (
                          <Link to="/leads/$leadId" params={{ leadId: m.lead_id }} className="block truncate font-medium hover:text-signal" onClick={(e) => e.stopPropagation()}>
                            {name || m.to_email}
                          </Link>
                        ) : (
                          <span className="block truncate">{m.to_email}</span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">{m.to_email}</span>
                      </TableCell>
                      <TableCell className="max-w-64 truncate">{m.subject}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{stepLabel(m.step, m.is_manual)}</TableCell>
                      <TableCell className="max-w-40 truncate text-xs">{m.campaigns?.name ?? "—"}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs">{m.from_email}</TableCell>
                      <TableCell className="tabular whitespace-nowrap text-xs">{formatDateTime(m.sent_at ?? m.created_at)}</TableCell>
                      <TableCell>
                        <DeliveryBadge status={m.status} />
                      </TableCell>
                    </TableRow>
                    {openId === m.id && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30">
                          {m.cc && <p className="text-xs text-muted-foreground">CC: {m.cc}</p>}
                          <pre className="whitespace-pre-wrap font-sans text-sm">{m.body}</pre>
                          {m.error && <p className="mt-1 text-xs text-destructive">{m.error}</p>}
                          {m.gmail_thread_id && (
                            <Link to="/inbox" search={{ thread: m.gmail_thread_id }} className="mt-2 inline-block text-xs text-signal hover:underline">
                              Open conversation
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => set({ page: data.page - 1 })}>
            Previous
          </Button>
          <span className="tabular text-sm text-muted-foreground">
            {data.page} / {pages}
          </span>
          <Button size="sm" variant="outline" disabled={data.page >= pages} onClick={() => set({ page: data.page + 1 })}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}

function UpcomingFollowUps() {
  const { data } = useSuspenseQuery(upcomingFollowUpsQuery());
  const rows = useMemo(() => {
    const now = Date.now();
    return data
      .map((cl) => {
        const next = cl.campaigns ? nextFollowUp(cl.campaigns, cl) : null;
        return next ? { cl, next, overdue: next.dueAt.getTime() <= now } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.next.dueAt.getTime() - b.next.dueAt.getTime());
  }, [data]);

  if (!rows.length)
    return (
      <EmptyState title="No follow-ups coming up">
        Write follow-ups on a campaign's “Follow-ups” tab. They go out automatically, in the same thread, to people who haven't replied.
      </EmptyState>
    );

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        Follow-ups stop by themselves when someone replies, bounces or unsubscribes. They only go out while the campaign is sending, within each account's daily limit.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Next</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>From</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ cl, next, overdue }) => {
              const l = cl.leads;
              const name = l ? [l.first_name, l.last_name].filter(Boolean).join(" ") : "";
              return (
                <TableRow key={cl.id}>
                  <TableCell className="max-w-56">
                    {l ? (
                      <Link to="/leads/$leadId" params={{ leadId: l.id }} className="block truncate font-medium hover:text-signal">
                        {name || l.email}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <span className="block truncate text-xs text-muted-foreground">{l?.email}</span>
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-sm">
                    <Link to="/campaigns/$campaignId" params={{ campaignId: cl.campaign_id }} className="hover:text-signal">
                      {cl.campaigns?.name}
                    </Link>
                    {cl.campaigns?.status !== "active" && <span className="ml-1 text-xs text-muted-foreground">(paused)</span>}
                  </TableCell>
                  <TableCell className="text-sm">Follow-up {next.n}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-sm">{overdue ? "Next send run" : formatDateTime(next.dueAt.toISOString())}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs">{cl.sending_accounts?.email ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
