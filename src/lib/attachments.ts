// Pure: attachments stored on campaigns and messages (files live in private storage).

export type FileAttachment = { kind: "file"; path: string; name: string; size: number; type: string };
export type LinkAttachment = { kind: "link"; url: string; label: string };
export type Attachment = FileAttachment | LinkAttachment;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_BUCKET = "attachments";

export function parseAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const a of raw) {
    if (a?.kind === "file" && typeof a.path === "string" && typeof a.name === "string")
      out.push({ kind: "file", path: a.path, name: a.name, size: Number(a.size) || 0, type: String(a.type || "application/octet-stream") });
    else if (a?.kind === "link" && typeof a.url === "string" && /^https?:\/\//.test(a.url))
      out.push({ kind: "link", url: a.url, label: typeof a.label === "string" && a.label.trim() ? a.label.trim() : a.url });
  }
  return out;
}

export function totalFileBytes(list: Attachment[]): number {
  return list.reduce((n, a) => n + (a.kind === "file" ? a.size : 0), 0);
}

/** Links are added to the end of the email body as formatted links. */
export function appendLinks(body: string, list: Attachment[]): string {
  const links = list.filter((a): a is LinkAttachment => a.kind === "link");
  if (!links.length) return body;
  return `${body.trimEnd()}\n\n${links.map((l) => `[${l.label}](${l.url})`).join("\n")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
