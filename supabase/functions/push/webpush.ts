// Web Push with WebCrypto only: VAPID (RFC 8292) and the aes128gcm payload (RFC 8291/8188).
// The published app runs on Cloudflare Workers, where the `web-push` package does not even load
// (its asn1.js → safer-buffer calls `buffer.hasOwnProperty` on the module namespace), so the
// server never imports it. The same code runs in Node 20+ (tests, preview).

type Bytes = Uint8Array;
const text = (s: string): Bytes => {
  const encoded = new TextEncoder().encode(s);
  const out = new Uint8Array(encoded.length);
  out.set(encoded);
  return out;
};
function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(value: string): Bytes {
  const s = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** VAPID key pair as `web-push` stores it: uncompressed P-256 point (65 bytes) and `d` (32 bytes). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("Chiave VAPID non generata");
  return { publicKey: toBase64Url(raw), privateKey: jwk.d };
}

function pointJwk(publicKey: Bytes) {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("Chiave pubblica non valida");
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(publicKey.subarray(1, 33)),
    y: toBase64Url(publicKey.subarray(33)),
  };
}

/** `Authorization: vapid t=<JWT ES256>, k=<public key>` for the push service of the endpoint. */
export async function vapidAuthorization(
  endpoint: string,
  subject: string,
  keys: { publicKey: string; privateKey: string },
  now = Date.now(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...pointJwk(fromBase64Url(keys.publicKey)), d: keys.privateKey, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const part = (o: object) => toBase64Url(text(JSON.stringify(o)));
  // At most 24 hours (RFC 8292); 12 hours like `web-push`.
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  // WebCrypto returns r‖s (64 bytes), which is the JOSE signature format.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text(unsigned)),
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

/** Body of a push message encrypted for the subscription (one aes128gcm record). */
export async function encryptPayload(
  subscription: { p256dh: string; auth: string },
  plaintext: string,
): Promise<Bytes> {
  const uaPublic = fromBase64Url(subscription.p256dh);
  const authSecret = fromBase64Url(subscription.auth);
  if (authSecret.length !== 16) throw new Error("Segreto della sottoscrizione non valido");
  const receiver = await crypto.subtle.importKey(
    "jwk",
    { ...pointJwk(uaPublic), ext: true },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, local.privateKey, 256),
  );
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(text("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const record = 4096;
  // One record: the data, then the 0x02 delimiter of the last record (no padding).
  const data = concat(text(plaintext), new Uint8Array([2]));
  if (data.length + 16 > record) throw new Error("Notifica troppo lunga");
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, data),
  );
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, record);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}
