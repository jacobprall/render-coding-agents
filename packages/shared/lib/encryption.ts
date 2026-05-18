import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

function deriveKeyMaterial(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate a 32-byte key with: openssl rand -hex 32",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const salt = process.env.ENCRYPTION_SALT?.trim() || "open-forge-llm-api-key-v1";
  return scryptSync(raw, salt, 32);
}

function encryptUtf8(plaintext: string): string {
  const key = deriveKeyMaterial();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

function decryptUtf8(stored: string): string {
  const key = deriveKeyMaterial();
  const buf = Buffer.from(stored, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** True when an encryption secret is present (hex 64 or any passphrase for scrypt fallback). */
export function isLlmKeyEncryptionConfigured(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY?.trim());
}

/**
 * Encrypts a UTF-8 string for storage in `llm_api_keys.encrypted_key`.
 * Format: base64(iv || ciphertext || authTag)
 */
export function encryptLlmApiKey(plaintext: string): string {
  return encryptUtf8(plaintext);
}

export function decryptLlmApiKey(stored: string): string {
  return decryptUtf8(stored);
}

export function encryptToken(plaintext: string): string {
  return encryptUtf8(plaintext);
}

export function decryptToken(stored: string): string {
  return decryptUtf8(stored);
}

export function decryptTokenSafe(value: string): string {
  try {
    return decryptToken(value);
  } catch {
    return value;
  }
}
