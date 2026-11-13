// Server-only IMAP client: reads new emails from any mailbox's inbox (read-only, never marks them read).
import { GmailError as MailError } from "./gmail.server";
import { imapQuote, parseHeaderBlock } from "./mail-protocol";
import { openMailSocket, type MailSocket } from "./socket.server";

export type ImapConfig = { host: string; port: number; username: string; password: string };
type Untagged = { text: string; literals: Uint8Array[] };

const dec = new TextDecoder();

export class ImapSession {
  private n = 0;
  constructor(private s: MailSocket) {}

  async command(cmd: string): Promise<Untagged[]> {
    const tag = `a${++this.n}`;
    await this.s.write(`${tag} ${cmd}\r\n`);
    const items: Untagged[] = [];
    for (;;) {
      let line = await this.s.readLine();
      const item: Untagged = { text: "", literals: [] };
      for (;;) {
        const lit = line.match(/\{(\d+)\}$/);
        item.text += line;
        if (!lit) break;
        item.literals.push(await this.s.readBytes(Number(lit[1])));
        line = await this.s.readLine();
      }
      if (item.text.startsWith(`${tag} `)) {
        if (!/^\S+ OK/i.test(item.text)) {
          const msg = item.text.slice(tag.length + 1).slice(0, 300);
          throw new MailError(`Inbox server said: ${msg}`, 0, /AUTHENTICATIONFAILED|LOGIN|credentials|password/i.test(msg) ? "auth" : "other");
        }
        return items;
      }
      items.push(item);
    }
  }

  async selectInbox(): Promise<{ uidValidity: number }> {
    const items = await this.command("EXAMINE INBOX");
    const uv = items.map((i) => i.text.match(/UIDVALIDITY (\d+)/i)?.[1]).find(Boolean);
    return { uidValidity: Number(uv ?? 0) };
  }

  async search(criteria: string): Promise<number[]> {
    const items = await this.command(`UID SEARCH ${criteria}`);
    const out: number[] = [];
    for (const i of items) {
      const m = i.text.match(/^\* SEARCH ?(.*)$/i);
      if (m?.[1]) out.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number));
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }

  async fetchHeaders(uids: number[]): Promise<{ uid: number; headers: Record<string, string> }[]> {
    if (!uids.length) return [];
    const fields = "MESSAGE-ID IN-REPLY-TO REFERENCES FROM SUBJECT DATE AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND X-FAILED-RECIPIENTS";
    const items = await this.command(`UID FETCH ${uids.join(",")} (UID BODY.PEEK[HEADER.FIELDS (${fields})])`);
    return items
      .filter((i) => /FETCH/i.test(i.text))
      .map((i) => ({ uid: Number(i.text.match(/UID (\d+)/i)?.[1] ?? 0), headers: parseHeaderBlock(i.literals.map((l) => dec.decode(l)).join("")) }))
      .filter((x) => x.uid > 0);
  }

  async fetchRaw(uid: number): Promise<Uint8Array | null> {
    const items = await this.command(`UID FETCH ${uid} (UID BODY.PEEK[])`);
    const hit = items.find((i) => /FETCH/i.test(i.text) && i.literals.length);
    return hit?.literals[0] ?? null;
  }

  async logout() {
    await this.command("LOGOUT").catch(() => undefined);
  }
}

export async function withImap<T>(cfg: ImapConfig, fn: (s: ImapSession) => Promise<T>): Promise<T> {
  if (cfg.port !== 993) throw new MailError("Use port 993 (encrypted) for the inbox.", 0, "config");
  let sock: MailSocket;
  try {
    sock = await openMailSocket(cfg.host, cfg.port, { tls: true, timeoutMs: 25000 });
  } catch (e) {
    throw new MailError((e as Error).message, 0, "config");
  }
  const session = new ImapSession(sock);
  try {
    const greeting = await sock.readLine();
    if (!/^\* (OK|PREAUTH)/i.test(greeting)) throw new MailError(`Inbox server said: ${greeting.slice(0, 200)}`, 0, "config");
    await session.command(`LOGIN ${imapQuote(cfg.username)} ${imapQuote(cfg.password)}`);
    const out = await fn(session);
    await session.logout();
    return out;
  } finally {
    sock.close();
  }
}
