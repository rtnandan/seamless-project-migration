import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Globe, KeyRound, Plus, RefreshCw, Trash2, XCircle, AlertTriangle, PlugZap, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, formatDateTime } from "@/components/app/page";
import { AccountStatusBadge } from "@/components/app/status";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_APP_URL } from "@/lib/compose";
import { syncSendingAccounts } from "@/lib/mail.functions";
import { checkAccountDomain, detectMailboxProvider, removeSendingAccount, saveMailAccount, testSendingAccount } from "@/lib/accounts.functions";
import { providerByKey, presetForAccount } from "@/lib/providers";
import type { DomainHealth } from "@/lib/dns-health";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accountsQuery, settingsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({
    meta: [
      { title: "Sending accounts — DECILE Outreach" },
      { name: "description", content: "Zoho, GoDaddy, Gmail and other sending accounts, daily limits, SPF/DKIM/DMARC and email settings." },
      { property: "og:title", content: "Sending accounts — DECILE Outreach" },
      { property: "og:description", content: "Zoho, GoDaddy, Gmail and other sending accounts, daily limits, SPF/DKIM/DMARC and email settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(accountsQuery()),
      context.queryClient.ensureQueryData(settingsQuery()),
    ]);
  },
  component: AccountsPage,
});

type Account = Awaited<ReturnType<NonNullable<ReturnType<typeof accountsQuery>["queryFn"]>>>[number];

function AccountsPage() {
  const { data: accounts } = useSuspenseQuery(accountsQuery());
  const { data: settings } = useSuspenseQuery(settingsQuery());
  const qc = useQueryClient();
  const sync = useServerFn(syncSendingAccounts);
  const [syncing, setSyncing] = useState(false);

  async function runSync() {
    setSyncing(true);
    try {
      const r = await sync();
      const failed = r.results.filter((x) => x.error);
      if (r.found === 0) toast.error("No connected Gmail account found");
      else if (failed.length) toast.error(`${failed.length} account(s) couldn't be reached`, { description: failed[0]?.error });
      else toast.success(`${r.found} account(s) connected and healthy`);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const [addOpen, setAddOpen] = useState(false);
  const totalDaily = accounts.filter((a) => a.status !== "paused").reduce((n, a) => n + a.daily_limit, 0);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Sending accounts"
        description={`Add as many mailboxes as you like — Zoho, GoDaddy, Gmail, Outlook or any other. Campaigns rotate between them and each keeps its own daily limit. ${accounts.length} account${accounts.length === 1 ? "" : "s"} · up to ${totalDaily}/day in total.`}
        actions={
          <>
            <Button variant="outline" onClick={runSync} disabled={syncing}>
              <RefreshCw className={syncing ? "animate-spin" : ""} /> {syncing ? "Checking…" : "Check Gmail connections"}
            </Button>
            <Button variant="signal" onClick={() => setAddOpen(true)}>
              <Plus /> Connect mailbox
            </Button>
          </>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No sending accounts yet"
          action={
            <Button variant="signal" onClick={() => setAddOpen(true)}>
              <Plus /> Add your first account
            </Button>
          }
        >
          Connect a Zoho, GoDaddy, Gmail or any other mailbox with just its email and password.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <AccountRow key={`${a.id}-${a.updated_at}`} account={a} />
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        For cold email, keep each new account at 30–50 a day for the first 2 weeks, then raise it slowly (most providers block accounts that jump to hundreds a day). Spreading sends across 10+ accounts is safer than pushing one hard.
      </p>

      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />

      <SettingsCard key={settings?.updated_at ?? "new"} settings={settings} />
    </>
  );
}

function AccountRow({ account }: { account: Account }) {
  const qc = useQueryClient();
  const [limit, setLimit] = useState(String(account.daily_limit));
  const [fromName, setFromName] = useState(account.from_name);
  const dirty = Number(limit) !== account.daily_limit || fromName !== account.from_name;
  const pct = Math.min(100, (account.sent_today / account.daily_limit) * 100);

  async function save(patch: { daily_limit?: number; from_name?: string; status?: string }) {
    const { error } = await supabase.from("sending_accounts").update(patch).eq("id", account.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    await qc.invalidateQueries();
  }

  const test = useServerFn(testSendingAccount);
  const del = useServerFn(removeSendingAccount);
  const [testing, setTesting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function runTest() {
    setTesting(true);
    try {
      const r = await test({ data: { accountId: account.id } });
      if (r.ok) toast.success(r.inbox ? "Sending and inbox both work" : "Sending works (no inbox set, so replies won't be read)");
      else toast.error("Couldn't sign in", { description: r.error });
      await qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${account.email}? It stops sending and is taken out of every campaign. Sent history stays.`)) return;
    try {
      await del({ data: { accountId: account.id } });
      toast.success("Account removed");
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const n = Math.round(Number(limit));
  return (
    <div className="rounded-lg border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{account.email}</div>
          <div className="text-xs text-muted-foreground">
            {account.provider === "gmail_api" ? "Gmail (connected)" : presetForAccount(account).label} · Last checked {formatDateTime(account.last_checked_at)}
          </div>
        </div>
        <AccountStatusBadge status={account.status} />
        <Button size="sm" variant="outline" onClick={runTest} disabled={testing}>
          <PlugZap /> {testing ? "Testing…" : "Test"}
        </Button>
        {account.provider === "smtp" && (
          <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)} aria-label="Change password or servers">
            <KeyRound />
          </Button>
        )}
        {account.status === "paused" ? (
          <Button size="sm" variant="outline" onClick={() => save({ status: "active" })}>
            Resume
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => save({ status: "paused" })}>
            Pause
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={remove} aria-label="Remove account">
          <Trash2 />
        </Button>
      </div>
      {account.last_error && account.status !== "active" && <p className="mt-2 text-xs text-destructive">{account.last_error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <Progress value={pct} className="h-1.5" />
        <span className="tabular w-32 shrink-0 text-right text-xs text-muted-foreground">
          {account.sent_today}/{account.daily_limit} today
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5 sm:w-56">
          <Label htmlFor={`from-${account.id}`}>Sender name</Label>
          <Input id={`from-${account.id}`} value={fromName} placeholder="e.g. Nandan from DECILE" onChange={(e) => setFromName(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:w-36">
          <Label htmlFor={`limit-${account.id}`}>Daily limit</Label>
          <Input id={`limit-${account.id}`} type="number" min={1} max={2000} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <Button size="sm" disabled={!dirty || !(n >= 1 && n <= 2000)} onClick={() => save({ daily_limit: n, from_name: fromName.trim() })}>
          Save
        </Button>
      </div>
      <DomainPanel account={account} />
      {editOpen && <AddAccountDialog open={editOpen} onOpenChange={setEditOpen} existing={account} />}
    </div>
  );
}

function DomainPanel({ account }: { account: Account }) {
  const qc = useQueryClient();
  const check = useServerFn(checkAccountDomain);
  const [busy, setBusy] = useState(false);
  const [selector, setSelector] = useState(account.dkim_selector ?? "");
  const health = account.dns_check as DomainHealth | null;
  const failing = health?.items.filter((i) => i.level !== "pass").length ?? 0;
  const [open, setOpen] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const h = await check({ data: { accountId: account.id, selector: selector.trim() } });
      const bad = h.items.filter((i) => i.level !== "pass").length;
      if (bad) toast.warning(`${bad} thing${bad === 1 ? "" : "s"} to fix on ${h.domain}`);
      else toast.success(`${h.domain} is set up correctly`);
      setOpen(true);
      await qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border bg-background/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Domain setup (SPF, DKIM, DMARC)</span>
        {health ? (
          failing ? (
            <span className="text-xs font-medium text-destructive">{failing} to fix</span>
          ) : (
            <span className="text-xs font-medium text-success">All good</span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">Not checked yet</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {health && (
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Details"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={run} disabled={busy}>
            {busy ? "Checking…" : health ? "Check again" : "Check domain"}
          </Button>
        </div>
      </div>
      {open && health && (
        <div className="mt-3 space-y-2">
          {health.items.map((i) => (
            <div key={i.key + i.label} className="flex gap-2 text-sm">
              {i.level === "pass" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : i.level === "warn" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0">
                <span className="font-medium">{i.label}: </span>
                <span className="break-words text-muted-foreground">{i.message}</span>
                {i.fix && <div className="mt-1 break-words rounded bg-muted px-2 py-1 font-mono text-xs">{i.fix}</div>}
              </div>
            </div>
          ))}
          {!health.managed && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div className="space-y-1">
                <Label htmlFor={`sel-${account.id}`} className="text-xs">
                  DKIM selector (from your provider's DKIM page)
                </Label>
                <Input id={`sel-${account.id}`} className="h-8 w-48" value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="e.g. zmail" />
              </div>
              <Button size="sm" variant="outline" onClick={run} disabled={busy}>
                Check with this selector
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Add these at the place you manage your domain (GoDaddy, Hostinger, Cloudflare…). Changes can take up to a few hours to show. Checked {formatDateTime(health.checkedAt)}.
          </p>
        </div>
      )}
    </div>
  );
}

function AddAccountDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (v: boolean) => void; existing?: Account }) {
  const qc = useQueryClient();
  const saveAccount = useServerFn(saveMailAccount);
  const detect = useServerFn(detectMailboxProvider);
  const syncGoogle = useServerFn(syncSendingAccounts);
  const [email, setEmail] = useState(existing?.email ?? "");
  const [fromName, setFromName] = useState(existing?.from_name ?? "");
  const [password, setPassword] = useState("");
  const [dailyLimit, setDailyLimit] = useState("50");
  const [providerKey, setProviderKey] = useState<string | null>(existing ? presetForAccount(existing).key : null);
  const [detectedFor, setDetectedFor] = useState(existing?.email ?? "");
  const [needServer, setNeedServer] = useState(false);
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = providerKey ? providerByKey(providerKey) : null;

  async function runDetect(value: string) {
    const v = value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) || v === detectedFor) return;
    setDetectedFor(v);
    try {
      const r = await detect({ data: { email: v } });
      setProviderKey(r.providerKey);
    } catch {
      setProviderKey("custom");
    }
  }

  async function connectGoogle() {
    setBusy(true);
    setError(null);
    try {
      const r = await syncGoogle();
      const want = email.trim().toLowerCase();
      const hit = r.results.find((x) => x.email?.toLowerCase() === want && !x.error);
      await qc.invalidateQueries();
      if (hit) {
        toast.success(`${want} connected with Google`);
        onOpenChange(false);
      } else {
        setError(`${want} isn't signed in with Google yet. Use an app password below for this account.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await saveAccount({
        data: {
          accountId: existing?.id,
          email: email.trim(),
          fromName: fromName.trim(),
          password,
          dailyLimit: Math.max(1, Math.min(2000, Math.round(Number(dailyLimit) || 50))),
          ...(needServer && server.trim() ? { smtpHost: server.trim() } : {}),
        },
      });
      setProviderKey(r.providerKey);
      if (!r.ok) {
        setError(r.error);
        if (r.reason === "servers") setNeedServer(true);
        return;
      }
      if (r.warning) toast.warning(`${email} connected for sending`, { description: r.warning, duration: 12000 });
      else toast.success(existing ? "Account updated" : `${email} connected`);
      await qc.invalidateQueries();
      onOpenChange(false);
      setPassword("");
      if (!existing) {
        setEmail("");
        setFromName("");
        setProviderKey(null);
        setDetectedFor("");
        setNeedServer(false);
        setServer("");
      }
    } catch (e) {
      setError((e as Error).message.replace(/^\[.*?\]\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  const passwordLabel = p?.needsAppPassword ? "App password" : p?.key.startsWith("zoho") ? "Password (or app password)" : "Password";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-auto">
        <DialogHeader>
          <DialogTitle>{existing ? `Update ${existing.email}` : "Connect a mailbox"}</DialogTitle>
          <DialogDescription>Enter the email and password — we find the right settings automatically. The password is stored encrypted and never shown again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc-email">Email address</Label>
            <Input
              id="acc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => runDetect(e.target.value)}
              disabled={!!existing}
              placeholder="nandan@decilemedia.com"
            />
            {p && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {p.key === "custom" ? "Other email host" : p.label.replace(/ \(.*\)$/, "")}
              </p>
            )}
          </div>

          {p?.key === "gmail" && !existing && (
            <Button type="button" variant="signal" className="w-full" disabled={busy || !email} onClick={connectGoogle}>
              Connect with Google (no password)
            </Button>
          )}
          {p && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <ul className="list-disc space-y-1 pl-4 text-foreground/85">
                {p.passwordSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              {(p.passwordLink || p.extraLink) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.extraLink && (
                    <Button asChild size="sm" variant="outline">
                      <a href={p.extraLink.url} target="_blank" rel="noreferrer">
                        {p.extraLink.label} <ExternalLink />
                      </a>
                    </Button>
                  )}
                  {p.passwordLink && (
                    <Button asChild size="sm" variant="outline">
                      <a href={p.passwordLink.url} target="_blank" rel="noreferrer">
                        <KeyRound /> {p.passwordLink.label} <ExternalLink />
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="acc-pass">{passwordLabel}</Label>
            <Input
              id="acc-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onFocus={() => runDetect(email)}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email && password && !busy && submit()}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="acc-name">Sender name</Label>
              <Input id="acc-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Nandan from DECILE" />
            </div>
            {!existing && (
              <div className="space-y-1.5">
                <Label htmlFor="acc-limit">Emails per day</Label>
                <Input id="acc-limit" type="number" min={1} max={2000} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
              </div>
            )}
          </div>
          {needServer && (
            <div className="space-y-1.5">
              <Label htmlFor="acc-server">Mail server name</Label>
              <Input id="acc-server" value={server} onChange={(e) => setServer(e.target.value)} placeholder="mail.yourhost.com" />
              <p className="text-xs text-muted-foreground">Your email host lists this as the “SMTP” or “outgoing” server. We'll work out the rest.</p>
            </div>
          )}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="signal" onClick={submit} disabled={busy || !email.trim() || !password || (needServer && !server.trim())}>
            {busy ? "Connecting…" : existing ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsCard({
  settings,
}: {
  settings: { app_url: string | null; timezone: string; signature: string } | null;
}) {
  const qc = useQueryClient();
  const [appUrl, setAppUrl] = useState(settings?.app_url ?? "");
  const [timezone, setTimezone] = useState(settings?.timezone ?? "Asia/Kolkata");
  const [signature, setSignature] = useState(settings?.signature ?? "");

  async function save() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      toast.error("Unknown time zone — use a name like Asia/Kolkata");
      return;
    }
    const { error } = await supabase
      .from("app_settings")
      .upsert({ owner_id: u.user.id, app_url: appUrl.trim() || null, timezone: timezone.trim(), signature });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Settings saved");
    await qc.invalidateQueries();
  }

  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold">Email settings</h2>
      <div className="mt-4 max-w-2xl space-y-4 rounded-lg border bg-card p-5 shadow-card">
        <div className="space-y-1.5">
          <Label htmlFor="signature">Signature</Label>
          <Textarea id="signature" rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={"Nandan T\nDECILE Media"} />
          <p className="text-xs text-muted-foreground">Added under every email. Details like {"{{first_name}}"} work here too.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tz">Time zone for daily limits</Label>
            <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appurl">Unsubscribe link address</Label>
            <Input id="appurl" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder={DEFAULT_APP_URL} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave the unsubscribe address empty to use your published app's address. Publish the app so unsubscribe links work.
        </p>
        <Button onClick={save}>Save settings</Button>
      </div>
    </section>
  );
}
