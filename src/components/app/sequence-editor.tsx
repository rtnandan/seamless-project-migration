import { useState } from "react";
import { ArrowDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TemplatePicker } from "@/components/app/template-picker";
import { composeEmail } from "@/lib/compose";
import type { LeadLike } from "@/lib/email-utils";
import { DELAY_PRESETS, MAX_FOLLOW_UPS, parseBehavior, parseFollowUps, type Behavior, type FollowUp } from "@/lib/followups";
import { cn } from "@/lib/utils";

/** Follow-up steps (up to 8) plus what happens when someone replies. */
export function SequenceEditor({
  followUps,
  behavior,
  subject,
  signature,
  sample,
  onSave,
}: {
  followUps: unknown;
  behavior: unknown;
  subject: string;
  signature: string;
  sample: LeadLike;
  onSave: (p: { follow_ups: FollowUp[]; behavior: Behavior }) => Promise<boolean>;
}) {
  const initialSteps = parseFollowUps(followUps);
  const initialBehavior = parseBehavior(behavior);
  const [steps, setSteps] = useState<FollowUp[]>(initialSteps.length ? initialSteps : []);
  const [b, setB] = useState<Behavior>(initialBehavior);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(steps) !== JSON.stringify(initialSteps) || JSON.stringify(b) !== JSON.stringify(initialBehavior);
  let day = 0;

  const patch = (i: number, p: Partial<FollowUp>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const addStep = () => setSteps([...steps, { delay_days: DELAY_PRESETS[Math.min(steps.length, DELAY_PRESETS.length - 1)] ?? 7, body: "" }]);

  async function save() {
    const clean = steps.filter((s) => s.body.trim());
    if (clean.length !== steps.length && !confirm("Empty steps will be removed. Continue?")) return;
    setSaving(true);
    const ok = await onSave({ follow_ups: clean, behavior: b });
    setSaving(false);
    if (ok) toast.success("Sequence saved");
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="rounded-lg border bg-card p-4 shadow-card">
        <div className="eyebrow">Step 1</div>
        <div className="mt-1 text-sm font-medium">First email · “{subject || "your subject"}”</div>
        <p className="mt-1 text-xs text-muted-foreground">Follow-ups go to people who haven't replied, in the same thread and from the same mailbox.</p>
      </div>

      {steps.map((s, i) => {
        day += s.delay_days;
        const preview = s.body.trim() ? composeEmail({ subject: "", body: s.body, signature, lead: sample }).body : "";
        return (
          <div key={i} className="space-y-2">
            <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground" />
            <div className="rounded-lg border bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">Step {i + 2}</span>
                <h3 className="font-sans text-sm font-semibold">Follow-up {i + 1}</h3>
                <span className="text-xs text-muted-foreground">· day {day}</span>
                <Button type="button" variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={`Remove follow-up ${i + 1}`}>
                  <Trash2 />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">Wait</span>
                {DELAY_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => patch(i, { delay_days: d })}
                    className={cn("tabular rounded border px-2 py-0.5 text-xs", s.delay_days === d ? "border-signal bg-signal-soft text-signal" : "hover:border-signal")}
                  >
                    {d} days
                  </button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="h-7 w-20"
                  value={s.delay_days}
                  onChange={(e) => patch(i, { delay_days: Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))) })}
                  aria-label={`Custom days before follow-up ${i + 1}`}
                />
                <span className="text-muted-foreground">after the previous email</span>
              </div>
              <Textarea
                className="mt-3 font-sans leading-relaxed"
                rows={4}
                value={s.body}
                onChange={(e) => patch(i, { body: e.target.value })}
                placeholder="Hi {{first_name|there}}, just bringing this to the top of your inbox — worth a quick chat?"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TemplatePicker kinds={["follow_up", "email"]} onPick={(t) => patch(i, { body: t.body })} />
                {preview && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Preview for {sample.first_name || "a sample lead"}</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/40 p-3 font-sans text-sm">{preview}</pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {steps.length < MAX_FOLLOW_UPS && (
        <Button type="button" variant="outline" onClick={addStep}>
          <Plus /> Add follow-up ({steps.length}/{MAX_FOLLOW_UPS})
        </Button>
      )}

      <div className="rounded-lg border bg-card p-4 shadow-card">
        <h3 className="font-sans text-sm font-semibold">When someone replies</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>• A real reply stops their follow-ups — you take it from the Inbox.</li>
          <li>• Bounces and unsubscribes always stop everything and add them to the opt-out list.</li>
        </ul>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Label className="font-normal">Out-of-office auto-replies</Label>
            <Select value={b.out_of_office} onValueChange={(v) => setB({ ...b, out_of_office: v as Behavior["out_of_office"] })}>
              <SelectTrigger className="h-8 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="continue">Keep sending follow-ups</SelectItem>
                <SelectItem value="stop">Stop the follow-ups</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={b.later_check_in} onCheckedChange={(v) => setB({ ...b, later_check_in: v })} />
              When they say “not now, later”, send one check-in after
              <Input
                type="number"
                min={1}
                max={365}
                className="h-7 w-20"
                value={b.later_delay_days}
                onChange={(e) => setB({ ...b, later_delay_days: Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))) })}
                disabled={!b.later_check_in}
                aria-label="Days before the check-in"
              />
              days
            </label>
            {b.later_check_in && (
              <Textarea rows={3} value={b.later_body} onChange={(e) => setB({ ...b, later_body: e.target.value })} aria-label="Check-in email" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Opens and link clicks aren't tracked: tracking pixels and tracked links push cold email into Promotions or spam, so the sequence reacts to replies instead.
          </p>
        </div>
      </div>

      <Button onClick={save} disabled={!dirty || saving}>
        {saving ? "Saving…" : dirty ? "Save sequence" : "Saved"}
      </Button>
    </div>
  );
}
