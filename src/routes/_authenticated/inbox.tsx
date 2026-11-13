import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Mail, MailOpen, RefreshCw, Reply, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, formatDateTime } from "@/components/app/page";
import { DeliveryBadge, LeadStatusBadge, ReplyCategoryBadge } from "@/components/app/status";
import { stepLabel } from "@/lib/followups";
import { markThreadRead, sendBulkReply, sendReply } from "@/lib/inbox.functions";
import { checkRepliesNow, setReplyCategory } from "@/lib/mail.functions";
import { campaignNamesQuery, inboxThreadsQuery, threadQuery, type InboxSearch } from "@/lib/queries";
import { REPLY_CATEGORIES, type ReplyCategory } from "@/lib/replies";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — DECILE Outreach" },
      { name: "description", content: "Every reply to your campaigns in one inbox. Answer each conversation in its thread." },
      { property: "og:title", content: "Inbox — DECILE Outreach" },
      { property: "og:description", content: "Every reply to your campaigns in one inbox. Answer each conversation in its thread." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): InboxSearch => ({
    filter: typeof s["filter"] === "string" && s["filter"] ? s["filter"] : undefined,
    campaign: typeof s["campaign"] === "string" && s["campaign"] ? s["campaign"] : undefined,
    thread: typeof s["thread"] === "string" && s["thread"] ? s["thread"] : undefined,
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter, campaign: search.campaign }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(inboxThreadsQuery(deps)),
      context.queryClient.ensureQueryData(campaignNamesQuery()),
    ]);
  },
  component: InboxPage,
});

type Thread = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof inboxThreadsQuery>["queryFn"]>>>>[number];

function InboxPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/inbox" });
  const qc = useQueryClient();
  const { data: threads } = useSuspenseQuery(inboxThreadsQuery(search));
  const { data: campaigns } = useSuspenseQuery(campaignNamesQuery());
  const check = useServerFn(checkRepliesNow);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  const open = threads.find((t) => t.thread_id === search.thread) ?? null;

  async function runCheck() {
    setChecking(true);
    try {
      const r = await check();
      const parts = [`${r.newReplies} new ${r.newReplies === 1 ? "reply" : "replies"}`, `${r.classified} sorted`];
      if (r.bounced) parts.push(`${r.bounced} bounced`);
      toast.success(parts.join(" · "));
      if (r.notes.length) toast.warning(r.notes.join("\n").slice(0, 400));
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  const setSearch = (patch: Partial<InboxSearch>) => navigate({ search: (prev) => ({ ...prev, ...patch }) });

  return (
    <>
      <PageHeader
        eyebrow="Conversations"
        title="Inbox"
        description="Replies from every sending account, checked every 10 minutes. Open one to answer it in the same thread, or tick several to send each person the same reply."
        actions={
          <Button variant="signal" onClick={runCheck} disabled={checking}>
            <RefreshCw className={checking ? "animate-spin" : undefined} /> {checking ? "Checking…" : "Check now"}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={search.filter ?? "all"} onValueChange={(v) => setSearch({ filter: v === "all" ? undefined : v, thread: undefined })}>
          <SelectTrigger className="w-48" aria-label="Show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All conversations</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="unsorted">Not sorted yet</SelectItem>
            {REPLY_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={search.campaign ?? "all"} onValueChange={(v) => setSearch({ campaign: v === "all" ? undefined : v, thread: undefined })}>
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
        {selected.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selected.length} selected</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button size="sm" variant="signal" onClick={() => setBulkOpen(true)}>
              <Users /> Reply to {selected.length}
            </Button>
          </div>
        )}
      </div>

      {threads.length === 0 ? (
        <EmptyState title={search.filter || search.campaign ? "Nothing here" : "No replies yet"}>
          When someone answers a campaign email from any of your accounts, the conversation shows up here.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul className={cn("max-h-[75vh] divide-y overflow-auto rounded-lg border bg-card shadow-card", open && "hidden lg:block")}>
            {threads.map((t) => (
              <ThreadRow
                key={t.thread_id}
                t={t}
                active={t.thread_id === search.thread}
                checked={selected.includes(t.thread_id)}
                onCheck={(v) => setSelected((s) => (v ? [...s, t.thread_id] : s.filter((x) => x !== t.thread_id)))}
                onOpen={() => setSearch({ thread: t.thread_id })}
              />
            ))}
          </ul>
          {open ? (
            <Conversation key={open.thread_id} thread={open} onBack={() => setSearch({ thread: undefined })} />
          ) : (
            <div className="hidden items-center justify-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground lg:flex">
              Pick a conversation to read and reply.
            </div>
          )}
        </div>
      )}

      <BulkReplyDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        threads={threads.filter((t) => selected.includes(t.thread_id))}
        onDone={() => setSelected([])}
      />
    </>
  );
}

function displayName(t: Thread) {
  return [t.lead_first_name, t.lead_last_name].filter(Boolean).join(" ") || t.from_email;
}

function ThreadRow({ t, active, checked, onCheck, onOpen }: { t: Thread; active: boolean; checked: boolean; onCheck: (v: boolean) => void; onOpen: () => void }) {
  return (
    <li className={cn("flex gap-3 px-3 py-3", active ? "bg-signal-soft/50" : "hover:bg-muted/50")}>
      <Checkbox className="mt-1" checked={checked} onCheckedChange={(v) => onCheck(v === true)} aria-label={`Select ${displayName(t)}`} />
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex items-center gap-2">
          {t.unread > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-signal" aria-label="Unread" />}
          <span className={cn("truncate text-sm", t.unread > 0 ? "font-semibold" : "font-medium")}>{displayName(t)}</span>
          <span className="tabular ml-auto shrink-0 text-xs text-muted-foreground">{formatDateTime(t.last_at)}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {t.campaign_name ? `Campaign: ${t.campaign_name}` : "No campaign"}
          {t.lead_company ? ` · ${t.lead_company}` : ""}
        </div>
        <div className="mt-1 line-clamp-2 text-sm text-foreground/80">{t.reply_summary || t.snippet}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ReplyCategoryBadge category={t.reply_category} />
          {t.message_count > 1 && <span className="text-xs text-muted-foreground">{t.message_count} messages</span>}
        </div>
      </button>
    </li>
  );
}

function Conversation({ thread, onBack }: { thread: Thread; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: messages, isLoading } = useQuery(threadQuery(thread.thread_id));
  const reply = useServerFn(sendReply);
  const markRead = useServerFn(markThreadRead);
  const setCategory = useServerFn(setReplyCategory);
  const [body, setBody] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [signature, setSignature] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (thread.unread > 0) {
      markRead({ data: { threadId: thread.thread_id } })
        .then(() => qc.invalidateQueries({ queryKey: ["inbox"] }))
        .catch(() => undefined);
    }
  }, [thread.thread_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastInbound = [...(messages ?? [])].reverse().find((m) => m.direction === "inbound");

  async function send() {
    const ccList = cc.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    setSending(true);
    try {
      const r = await reply({ data: { threadId: thread.thread_id, body, cc: ccList, includeSignature: signature } });
      toast.success(`Reply sent to ${r.to}`);
      setBody("");
      setCc("");
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function changeCategory(v: string) {
    if (!lastInbound) return;
    try {
      await setCategory({ data: { messageId: lastInbound.id, category: v as ReplyCategory } });
      toast.success("Updated");
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="flex min-w-0 flex-col rounded-lg border bg-card shadow-card">
      <header className="flex flex-wrap items-start gap-3 border-b p-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label="Back to list">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {thread.lead_id ? (
              <Link to="/leads/$leadId" params={{ leadId: thread.lead_id }} className="text-lg font-semibold hover:text-signal">
                {displayName(thread)}
              </Link>
            ) : (
              <span className="text-lg font-semibold">{thread.from_email}</span>
            )}
            {thread.lead_status && <LeadStatusBadge status={thread.lead_status} />}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {thread.from_email}
            {thread.lead_company ? ` · ${thread.lead_company}` : ""}
            {thread.campaign_name ? ` · Campaign: ${thread.campaign_name}` : ""}
            {thread.account_email ? ` · via ${thread.account_email}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={thread.reply_category ?? ""} onValueChange={changeCategory}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Change category">
              <SelectValue placeholder="Set category" />
            </SelectTrigger>
            <SelectContent>
              {REPLY_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Mark as unread"
            onClick={async () => {
              await markRead({ data: { threadId: thread.thread_id, unread: true } });
              await qc.invalidateQueries({ queryKey: ["inbox"] });
              onBack();
            }}
          >
            <Mail />
          </Button>
        </div>
      </header>

      <div className="max-h-[50vh] space-y-3 overflow-auto p-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {(messages ?? []).map((m) => {
          const mine = m.direction === "outbound";
          return (
            <article key={m.id} className={cn("rounded-md border p-3", mine ? "ml-6 bg-muted/40" : "mr-6 bg-background")}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {mine ? <Send className="h-3 w-3" /> : <MailOpen className="h-3 w-3" />}
                <span className="font-medium text-foreground">{mine ? `You (${m.from_email})` : m.from_email}</span>
                {mine && <span>→ {m.to_email}{m.cc ? `, cc ${m.cc}` : ""}</span>}
                {mine && <span className="rounded bg-secondary px-1.5 py-0.5">{stepLabel(m.step, m.is_manual)}</span>}
                <span className="tabular ml-auto">{formatDateTime(m.sent_at ?? m.created_at)}</span>
                {mine && m.status !== "sent" && <DeliveryBadge status={m.status} />}
              </div>
              {!mine && m.reply_summary && <p className="mt-2 text-sm font-medium text-signal">{m.reply_summary}</p>}
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-foreground/90">{m.body}</pre>
              {m.error && <p className="mt-1 text-xs text-destructive">{m.error}</p>}
            </article>
          );
        })}
      </div>

      <div className="space-y-3 border-t p-4">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="reply-body" className="flex items-center gap-2">
            <Reply className="h-4 w-4" /> Reply to {lastInbound?.from_email ?? thread.from_email}
          </Label>
          <Button variant="ghost" size="sm" onClick={() => setShowCc((v) => !v)}>
            {showCc ? "Hide CC" : "Add CC"}
          </Button>
        </div>
        {showCc && (
          <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="CC — e.g. colleague@company.com, boss@company.com" aria-label="CC" />
        )}
        <Textarea id="reply-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Hi ${thread.lead_first_name || "there"},\n\n`} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={signature} onCheckedChange={setSignature} /> Add my signature
          </label>
          <Button variant="signal" onClick={send} disabled={sending || !body.trim()}>
            <Send /> {sending ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function BulkReplyDialog({
  open,
  onOpenChange,
  threads,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  threads: Thread[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const bulk = useServerFn(sendBulkReply);
  const [body, setBody] = useState("Hi {{first_name}},\n\n");
  const [signature, setSignature] = useState(true);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const r = await bulk({ data: { threadIds: threads.map((t) => t.thread_id), body, includeSignature: signature } });
      if (r.failed.length) toast.warning(`${r.sent} sent, ${r.failed.length} failed`, { description: r.failed[0]?.error });
      else toast.success(`Sent ${r.sent} replies, each in its own conversation`);
      onOpenChange(false);
      onDone();
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Reply to {threads.length} people</DialogTitle>
          <DialogDescription>
            Each person gets their own email in their own conversation, from the account they wrote to. {"{{first_name}}"} and other details are filled in for each.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-24 overflow-auto text-xs text-muted-foreground">{threads.map((t) => t.from_email).join(", ")}</div>
        <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={signature} onCheckedChange={setSignature} /> Add my signature
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="signal" onClick={send} disabled={sending || !body.trim() || !threads.length}>
            <Send /> {sending ? "Sending…" : `Send ${threads.length} replies`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
