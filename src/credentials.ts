import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as crypto from 'crypto';

const CRED_DIR = join(homedir(), '.restaurant-mcp');
const CRED_FILE = join(CRED_DIR, 'credentials.enc');

// Use machine-specific key derivation for basic protection
// Note: For stronger security on Windows, consider using node-dpapi or keytar with proper native setup
function getEncryptionKey(): Buffer {
  const machineId = `${homedir()}-restaurant-mcp-v1`;
  return crypto.scryptSync(machineId, 'restaurant-mcp-salt', 32);
}

export type CredentialKey =
  | 'resy-api-key'
  | 'resy-auth-token'
  | 'resy-email'
  | 'resy-password'
  | 'opentable-token';

interface CredentialStore {
  [key: string]: string;
}

async function loadCredentials(): Promise<CredentialStore> {
  try {
    await fs.mkdir(CRED_DIR, { recursive: true });
    const encrypted = await fs.readFile(CRED_FILE);

    const iv = encrypted.subarray(0, 16);
    const authTag = encrypted.subarray(16, 32);
    const data = encrypted.subarray(32);

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return {};
  }
}

async function saveCredentials(store: CredentialStore): Promise<void> {
  await fs.mkdir(CRED_DIR, { recursive: true });

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const data = JSON.stringify(store);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  await fs.writeFile(CRED_FILE, combined);
}

export async function getCredential(key: CredentialKey): Promise<string | null> {
  const store = await loadCredentials();
  return store[key] || null;
}

export async function setCredential(key: CredentialKey, value: string): Promise<void> {
  const store = await loadCredentials();
  store[key] = value;
  await saveCredentials(store);
}

export async function deleteCredential(key: CredentialKey): Promise<boolean> {
  const store = await loadCredentials();
  if (key in store) {
    delete store[key];
    await saveCredentials(store);
    return true;
  }
  return false;
}

export async function getAllCredentialKeys(): Promise<CredentialKey[]> {
  const store = await loadCredentials();
  return Object.keys(store) as CredentialKey[];
}

export function maskCredential(value: string): string {
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  return value.slice(0, 2) + '*'.repeat(value.length - 4) + value.slice(-2);
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return maskCredential(email);
  const maskedLocal = local.length <= 2
    ? '*'.repeat(local.length)
    : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
  return `${maskedLocal}@${domain}`;
}

export interface AuthStatus {
  platform: 'resy' | 'opentable';
  hasApiKey: boolean;
  hasAuthToken: boolean;
  hasLogin: boolean;
  email?: string;
}

export async function getResyAuthStatus(): Promise<AuthStatus> {
  const [apiKey, authToken, email, password] = await Promise.all([
    getCredential('resy-api-key'),
    getCredential('resy-auth-token'),
    getCredential('resy-email'),
    getCredential('resy-password'),
  ]);

  return {
    platform: 'resy',
    hasApiKey: !!apiKey,
    hasAuthToken: !!authToken,
    hasLogin: !!email && !!password,
    email: email ? maskEmail(email) : undefined,
  };
}

export async function getOpenTableAuthStatus(): Promise<AuthStatus> {
  const token = await getCredential('opentable-token');

  return {
    platform: 'opentable',
    hasApiKey: false,
    hasAuthToken: !!token,
    hasLogin: false,
  };
}
