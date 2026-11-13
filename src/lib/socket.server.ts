// Server-only TLS connection used to talk to mail servers (SMTP and IMAP).
// Works on the live app's runtime and in the preview.

export interface MailSocket {
  write(data: string | Uint8Array): Promise<void>;
  readLine(): Promise<string>;
  readBytes(n: number): Promise<Uint8Array>;
  /** Switches a plain connection to TLS (SMTP STARTTLS). */
  startTls(): Promise<void>;
  close(): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

class Inbox {
  buf = new Uint8Array(0);
  ended = false;
  error: Error | null = null;
  private wake: (() => void) | null = null;
  push(chunk: Uint8Array) {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    this.notify();
  }
  end(err?: unknown) {
    this.ended = true;
    if (err) this.error = err instanceof Error ? err : new Error(String(err));
    this.notify();
  }
  reset() {
    this.buf = new Uint8Array(0);
    this.ended = false;
    this.error = null;
  }
  private notify() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
  async waitFor(deadline: number) {
    if (this.error) throw this.error;
    if (this.ended) throw new Error("The mail server closed the connection.");
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("The mail server took too long to answer.")), Math.max(1, deadline - Date.now()));
      this.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }
  take(n: number) {
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}

type Raw = { write(b: Uint8Array): Promise<void>; close(): void; startTls(): Promise<void> };

function isWorkerRuntime() {
  return typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";
}

async function openCloudflare(host: string, port: number, tls: boolean, inbox: Inbox): Promise<Raw | null> {
  let mod: { connect: (a: unknown, o: unknown) => any };
  try {
    const spec = "cloudflare:sockets";
    mod = await import(/* @vite-ignore */ spec);
  } catch {
    return null;
  }
  let sock = mod.connect({ hostname: host, port }, { secureTransport: tls ? "on" : "starttls", allowHalfOpen: false });
  let writer = sock.writable.getWriter();
  let generation = 0;
  const pump = (s: any, gen: number) => {
    const reader = s.readable.getReader();
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (gen !== generation) return;
          if (done) break;
          if (value) inbox.push(value);
        }
        if (gen === generation) inbox.end();
      } catch (e) {
        if (gen === generation) inbox.end(e);
      }
    })();
  };
  pump(sock, generation);
  return {
    write: async (b) => {
      await writer.write(b);
    },
    close: () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
    },
    startTls: async () => {
      generation++;
      writer.releaseLock();
      inbox.reset();
      sock = sock.startTls({ expectedServerHostname: host });
      writer = sock.writable.getWriter();
      pump(sock, generation);
    },
  };
}

async function openNode(host: string, port: number, tls: boolean, inbox: Inbox): Promise<Raw> {
  const tlsMod = await import("node:tls");
  const netMod = await import("node:net");
  const attach = (s: import("node:net").Socket) => {
    s.on("data", (d: Uint8Array) => inbox.push(new Uint8Array(d)));
    s.on("error", (e) => inbox.end(e));
    s.on("close", () => inbox.end());
  };
  const connect = (factory: () => import("node:net").Socket, readyEvent: string) =>
    new Promise<import("node:net").Socket>((resolve, reject) => {
      const s = factory();
      const t = setTimeout(() => {
        s.destroy();
        reject(new Error(`Couldn't reach ${host}:${port}.`));
      }, 15000);
      s.once(readyEvent, () => {
        clearTimeout(t);
        resolve(s);
      });
      s.once("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  let sock = tls
    ? await connect(() => tlsMod.connect({ host, port, servername: host }), "secureConnect")
    : await connect(() => netMod.connect({ host, port }), "connect");
  attach(sock);
  return {
    write: (b) => new Promise((resolve, reject) => sock.write(b, (e) => (e ? reject(e) : resolve()))),
    close: () => sock.destroy(),
    startTls: async () => {
      const plain = sock;
      plain.removeAllListeners("data");
      plain.removeAllListeners("close");
      plain.removeAllListeners("error");
      inbox.reset();
      sock = await connect(() => tlsMod.connect({ socket: plain, servername: host }), "secureConnect");
      attach(sock);
    },
  };
}

/** Opens a connection. `tls: true` encrypts from the start (ports 465 and 993). */
export async function openMailSocket(host: string, port: number, opts: { tls: boolean; timeoutMs?: number }): Promise<MailSocket> {
  const inbox = new Inbox();
  const timeout = opts.timeoutMs ?? 20000;
  let raw: Raw | null = null;
  try {
    if (isWorkerRuntime()) raw = await openCloudflare(host, port, opts.tls, inbox);
    if (!raw) raw = await openNode(host, port, opts.tls, inbox);
  } catch (e) {
    throw new Error(`Couldn't connect to ${host}:${port} — ${(e as Error).message}`);
  }
  const r = raw;
  return {
    write: (data) => r.write(typeof data === "string" ? enc.encode(data) : data),
    async readLine() {
      const deadline = Date.now() + timeout;
      for (;;) {
        const i = inbox.buf.indexOf(10);
        if (i >= 0) return dec.decode(inbox.take(i + 1)).replace(/\r?\n$/, "");
        await inbox.waitFor(deadline);
      }
    },
    async readBytes(n) {
      const deadline = Date.now() + timeout;
      while (inbox.buf.length < n) await inbox.waitFor(deadline);
      return inbox.take(n);
    },
    startTls: () => r.startTls(),
    close: () => r.close(),
  };
}
