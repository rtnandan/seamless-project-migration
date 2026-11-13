// Server-only: encrypts mailbox passwords before they are stored, and reads them back for sending.
const enc = new TextEncoder();
const dec = new TextDecoder();

async function key() {
  const secret = process.env["MAIL_CREDENTIALS_KEY"];
  if (!secret) throw new Error("Mailbox password key is missing on the server.");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptPassword(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decryptPassword(stored: string): Promise<string> {
  const raw = fromB64(stored);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(), raw.slice(12));
  return dec.decode(pt);
}

const cache = new Map<string, string>();

/** The account's mailbox password (admin access; call only after the caller is allowed to use the account). */
export async function getAccountPassword(accountId: string): Promise<string> {
  const hit = cache.get(accountId);
  if (hit) return hit;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("account_credentials").select("password_enc").eq("account_id", accountId).maybeSingle();
  if (!data) throw new Error("This account's password is missing. Re-enter it on the Sending accounts page.");
  const pw = await decryptPassword(data.password_enc);
  cache.set(accountId, pw);
  return pw;
}

export async function saveAccountPassword(accountId: string, ownerId: string, password: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("account_credentials")
    .upsert({ account_id: accountId, owner_id: ownerId, password_enc: await encryptPassword(password) });
  if (error) throw new Error(error.message);
  cache.delete(accountId);
}
