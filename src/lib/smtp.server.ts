// Server-only SMTP client: sends one email through any mailbox (Zoho, GoDaddy, Gmail app password, …).
import { GmailError as MailError } from "./gmail.server";
import { openMailSocket, type MailSocket } from "./socket.server";
import { dotStuff, signInHint, smtpErrorKind } from "./mail-protocol";

export type SmtpConfig = { host: string; port: number; username: string; password: string; timeoutMs?: number };

async function reply(s: MailSocket) {
  const lines: string[] = [];
  for (;;) {
    const line = await s.readLine();
    lines.push(line);
    if (!/^\d{3}-/.test(line)) break;
  }
  const code = Number(lines[lines.length - 1]?.slice(0, 3)) || 0;
  return { code, text: lines.map((l) => l.slice(4)).join("\n"), lines };
}

async function expect(s: MailSocket, cmd: string | null, ok: number[], stage: string) {
  if (cmd !== null) await s.write(cmd + "\r\n");
  const r = await reply(s);
  if (!ok.includes(r.code)) {
    const text = `${r.code} ${r.text}`.slice(0, 300);
    const kind = smtpErrorKind(r.code, r.text, stage);
    const msg = kind === "auth" && stage === "the sign-in" ? `${signInHint(text)} (Server said: ${text})` : `Mail server refused ${stage}: ${text}`;
    throw new MailError(msg, r.code, kind);
  }
  return r;
}

async function openSession(cfg: SmtpConfig) {
  const implicit = cfg.port === 465;
  let s: MailSocket;
  try {
    s = await openMailSocket(cfg.host, cfg.port, { tls: implicit, ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}) });
  } catch (e) {
    throw new MailError((e as Error).message, 0, "config");
  }
  try {
    await expect(s, null, [220], "the connection");
    const helo = `EHLO ${cfg.username.split("@")[1] || "localhost"}`;
    let ehlo = await expect(s, helo, [250], "the greeting");
    if (!implicit) {
      if (!/STARTTLS/i.test(ehlo.text)) throw new MailError("This server doesn't offer an encrypted connection on that port. Try port 465.", 0, "config");
      await expect(s, "STARTTLS", [220], "encryption");
      await s.startTls();
      ehlo = await expect(s, helo, [250], "the greeting");
    }
    const auth = ehlo.lines.find((l) => /AUTH/i.test(l)) ?? "";
    const b64 = (v: string) => btoa(String.fromCharCode(...new TextEncoder().encode(v)));
    if (/PLAIN/i.test(auth) || !/LOGIN/i.test(auth)) {
      await expect(s, `AUTH PLAIN ${b64(`\u0000${cfg.username}\u0000${cfg.password}`)}`, [235], "the sign-in");
    } else {
      await expect(s, "AUTH LOGIN", [334], "the sign-in");
      await expect(s, b64(cfg.username), [334], "the sign-in");
      await expect(s, b64(cfg.password), [235], "the sign-in");
    }
    return s;
  } catch (e) {
    s.close();
    throw e;
  }
}

/** Signs in and out without sending anything — proves the details are right. */
export async function smtpVerify(cfg: SmtpConfig) {
  const s = await openSession(cfg);
  try {
    await s.write("QUIT\r\n");
  } finally {
    s.close();
  }
}

export async function smtpSend(cfg: SmtpConfig, envelope: { from: string; recipients: string[] }, mime: string) {
  const s = await openSession(cfg);
  try {
    await expect(s, `MAIL FROM:<${envelope.from}>`, [250], "the sender address");
    for (const r of envelope.recipients) await expect(s, `RCPT TO:<${r}>`, [250, 251], "the recipient");
    await expect(s, "DATA", [354], "the message");
    await s.write(dotStuff(mime) + "\r\n.\r\n");
    await expect(s, null, [250], "the message");
    await s.write("QUIT\r\n").catch(() => undefined);
  } finally {
    s.close();
  }
}
