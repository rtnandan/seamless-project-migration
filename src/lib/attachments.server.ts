// Server-only: loads attachment files from private storage for sending.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, type Attachment } from "./attachments";
import type { MimeAttachment } from "./mime";

export async function loadAttachmentFiles(db: SupabaseClient<Database>, list: Attachment[], ownerId: string): Promise<MimeAttachment[]> {
  const out: MimeAttachment[] = [];
  let total = 0;
  for (const a of list) {
    if (a.kind !== "file") continue;
    // Files must sit in the owner's own folder.
    if (!a.path.startsWith(`${ownerId}/`)) throw new Error(`Attachment ${a.name} doesn't belong to this account.`);
    const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(a.path);
    if (error || !data) throw new Error(`Couldn't load attachment ${a.name}: ${error?.message ?? "missing"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    total += bytes.length;
    if (total > MAX_ATTACHMENT_BYTES) throw new Error("Attachments are larger than 10 MB in total.");
    out.push({ filename: a.name, contentType: a.type, bytes });
  }
  return out;
}
