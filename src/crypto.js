/* ============================================================ *
 *  Trinacria at-rest encryption.
 *
 *  One password -> PBKDF2(SHA-256) -> AES-GCM key. Payloads are wrapped in a
 *  self-describing envelope { enc, salt, iv, ct } (all base64). The salt rides
 *  along with the data, so any device that knows the password can derive the
 *  key from the embedded salt and decrypt — that's what makes a single
 *  password unlock the synced gist on every device.
 * ============================================================ */

const ENC = "trinacria-aesgcm-v1";
const ITER = 210000;
const td = new TextDecoder();
const te = new TextEncoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const cryptoReady = () =>
  typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.getRandomValues === "function";

export const isEnvelope = (x) =>
  !!x && typeof x === "object" && x.enc === ENC && !!x.salt && !!x.iv && !!x.ct;

export function randomSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(password, saltB64) {
  const base = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(saltB64), iterations: ITER, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJSON(key, saltB64, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
  return { enc: ENC, salt: saltB64, iv: b64(iv), ct: b64(ct) };
}

/* Throws if the key is wrong (AES-GCM auth tag fails) — that's how we verify a
   password. Callers catch and treat a throw as "wrong password / corrupt". */
export async function decryptJSON(key, env) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) }, key, unb64(env.ct));
  return JSON.parse(td.decode(pt));
}

/* A small self-check token stored alongside the vault so we can validate a
   password on unlock without touching the real data. */
export const VERIFIER = { ok: "trinacria" };
