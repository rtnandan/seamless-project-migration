import { useRef, useState } from "react";
import { FileText, Link2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, formatBytes, totalFileBytes, type Attachment } from "@/lib/attachments";

/** Add files (PDFs, decks…) and links to an email. Files go to private storage in the user's own folder. */
export function AttachmentsPicker({
  value,
  onChange,
  disabled,
}: {
  value: Attachment[];
  onChange: (v: Attachment[]) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    const total = totalFileBytes(value) + list.reduce((n, f) => n + f.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachments can be up to 10 MB in total.");
      return;
    }
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Please sign in again.");
      const added: Attachment[] = [];
      for (const f of list) {
        const safe = f.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
        const path = `${u.user.id}/${crypto.randomUUID()}/${safe}`;
        const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream" });
        if (error) throw new Error(error.message);
        added.push({ kind: "file", path, name: f.name, size: f.size, type: f.type || "application/octet-stream" });
      }
      onChange([...value, ...added]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addLink() {
    const u = url.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(u)) {
      toast.error("Enter a full link starting with https://");
      return;
    }
    onChange([...value, { kind: "link", url: u, label: label.trim() || u }]);
    setUrl("");
    setLabel("");
    setLinkOpen(false);
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((a, i) => (
            <li key={`${a.kind}-${i}`} className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
              {a.kind === "file" ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <Link2 className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{a.kind === "file" ? a.name : a.label}</span>
              {a.kind === "file" && <span className="shrink-0 text-muted-foreground">{formatBytes(a.size)}</span>}
              {!disabled && (
                <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove attachment" className="text-muted-foreground hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} aria-label="Attach files" />
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Paperclip /> {uploading ? "Uploading…" : "Attach file"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen((v) => !v)}>
            <Link2 /> Add link
          </Button>
        </div>
      )}
      {linkOpen && (
        <div className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Text, e.g. Our media kit" className="h-8 sm:w-48" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-8" onKeyDown={(e) => e.key === "Enter" && addLink()} />
          <Button type="button" size="sm" onClick={addLink}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
