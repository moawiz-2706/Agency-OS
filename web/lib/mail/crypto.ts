// Gmail refresh tokens are encrypted here, on the server, before they reach the
// database: AES-256-GCM with a key that only lives in the server's environment
// (MAIL_TOKEN_KEY, 32 random bytes as base64). The mailbox address is bound in as
// associated data, so a token copied onto another inbox's row won't decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const b64u = (b: Buffer) => b.toString("base64url");

export function tokenKey(raw = process.env.MAIL_TOKEN_KEY): Buffer {
  const key = Buffer.from(raw ?? "", "base64");
  if (key.length !== 32) throw new Error("MAIL_TOKEN_KEY must be 32 random bytes, base64-encoded");
  return key;
}

/** Encrypts `plain` for the mailbox `email`. Output: "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptToken(plain: string, email: string, key = tokenKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`agencyos-mail:${email.toLowerCase()}`));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(".");
}

export function decryptToken(sealed: string, email: string, key = tokenKey()): string {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised token format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`agencyos-mail:${email.toLowerCase()}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
