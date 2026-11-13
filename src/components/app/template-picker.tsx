import { useQuery } from "@tanstack/react-query";
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { templatesQuery } from "@/lib/queries";
import { useState } from "react";

/** Pick a saved template to fill in the subject and body. */
export function TemplatePicker({
  kinds,
  onPick,
  disabled,
}: {
  kinds?: ("email" | "follow_up" | "reply")[];
  onPick: (t: { subject: string; body: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({ ...templatesQuery(), enabled: open });
  const list = kinds ? data.filter((t) => kinds.includes(t.kind as "email")) : data;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
          <LayoutTemplate /> Use template
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        {list.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No saved templates yet.
          </div>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {list.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onPick({ subject: t.subject, body: t.body });
                    setOpen(false);
                  }}
                >
                  <div className="font-medium">{t.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.subject || t.body.slice(0, 60)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
