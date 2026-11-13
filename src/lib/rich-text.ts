// Pure: light formatting for emails and signatures. [label](url), **bold**, *italic*.

const LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000}|mailto:[^\s)]{1,300})\)/g;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function hasFormatting(text: string): boolean {
  LINK_RE.lastIndex = 0;
  return LINK_RE.test(text) || /\*\*[^*\n]+\*\*/.test(text) || /(^|[^*])\*[^*\s][^*\n]*\*(?!\*)/.test(text);
}

/** Plain-text version: links become "label (url)", formatting marks are removed. */
export function toPlainText(text: string): string {
  return text
    .replace(LINK_RE, (_m, label: string, url: string) => (label.trim() === url.replace(/^mailto:/, "") ? label : `${label} (${url.replace(/^mailto:/, "")})`))
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*\n]*)\*(?!\*)/g, "$1$2");
}

/** Simple HTML version that reads like a personal email (no styling beyond links and emphasis). */
export function toHtml(text: string): string {
  const parts: string[] = [];
  let last = 0;
  LINK_RE.lastIndex = 0;
  for (const m of text.matchAll(LINK_RE)) {
    parts.push(inline(esc(text.slice(last, m.index))));
    parts.push(`<a href="${esc(m[2] ?? "")}">${inline(esc(m[1] ?? ""))}</a>`);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(inline(esc(text.slice(last))));
  const html = parts.join("").replace(/\r\n|\r|\n/g, "<br>\n");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${html}</div>`;
}

function inline(s: string) {
  return s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*\n]*)\*(?!\*)/g, "$1<em>$2</em>");
}
