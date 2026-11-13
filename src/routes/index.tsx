import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DECILE Outreach — personalised email campaigns" },
      { name: "description", content: "Upload leads, send personalised email campaigns in safe daily batches, and track every reply." },
      { property: "og:title", content: "DECILE Outreach" },
      { property: "og:description", content: "Personalised email campaigns, replies and follow-ups for DECILE Media." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <main className="flex min-h-screen flex-col bg-ink text-ink-foreground">
      <header className="flex items-center justify-between px-6 py-5 md:px-12">
        <Wordmark />
        <Button asChild variant="signal" size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>
      <section className="flex flex-1 flex-col justify-center px-6 pb-24 md:px-12">
        <div className="eyebrow mb-6 text-ink-foreground/60">DECILE Media · Outreach desk</div>
        <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] md:text-7xl">
          Every lead, one <em className="text-signal not-italic">personal</em> email at a time.
        </h1>
        <p className="mt-6 max-w-xl text-base text-ink-foreground/70">
          Upload your list, write once with personal details filled in, approve, and let the sender work through it
          in safe daily batches — without ever emailing someone twice or anyone who opted out.
        </p>
        <div className="mt-10 flex gap-3">
          <Button asChild variant="signal" size="lg">
            <Link to="/auth">Open the desk</Link>
          </Button>
        </div>
      </section>
      <section className="grid gap-6 border-t border-ink-foreground/15 px-6 py-8 text-sm text-ink-foreground/75 md:grid-cols-3 md:px-12">
        <p><span className="eyebrow mb-2 block text-ink-foreground/50">01 · Leads</span>Import and organise your list, with duplicates and invalid addresses checked before saving.</p>
        <p><span className="eyebrow mb-2 block text-ink-foreground/50">02 · Campaigns</span>Preview personal details, approve the message, and send in measured daily batches.</p>
        <p><span className="eyebrow mb-2 block text-ink-foreground/50">03 · Replies</span>Keep replies, opt-outs, and delivery issues together with every lead.</p>
      </section>
    </main>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-semibold tracking-tight ${className}`}>
      DECILE<span className="text-signal">.</span>
    </span>
  );
}
