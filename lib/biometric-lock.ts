/**
 * Salary lock — Face ID / Touch ID / Windows Hello through WebAuthn.
 *
 * A passkey is created on this device's built-in authenticator
 * (`authenticatorAttachment: 'platform'`) with `userVerification: 'required'`,
 * so every unlock needs the biometric — or the device passcode, which the OS
 * always offers as its own fallback and the web cannot opt out of.
 *
 * This is a presence check on the device in hand, not encryption: there is no
 * server to verify an assertion against, so the guarantee is that the page
 * never reads, renders or holds the salary until this check has passed.
 * Someone holding the unlocked phone cannot glance at it; someone with
 * devtools open on it could still read storage.
 *
 * Every export touches browser APIs and must only be called from an effect or
 * an event handler — never during render, since the page is prerendered.
 */

/* Only the credential id lives here, to tell the browser which passkey to ask
   for. It is an identifier, not a secret. */
const CREDENTIAL_KEY = 'apsara_salary_lock_credential';

/* The UV ("user verified") bit of the authenticator-data flags byte, which
   sits right after the 32-byte RP id hash. */
const FLAGS_OFFSET = 32;
const FLAG_USER_VERIFIED = 0x04;

export class BiometricError extends Error {}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function readCredentialId(): string | null {
  try {
    return window.localStorage.getItem(CREDENTIAL_KEY);
  } catch {
    return null;
  }
}

/* NotAllowedError covers both "cancelled" and "timed out" — the browser
   deliberately won't say which, so neither can the message. */
function describe(error: unknown): BiometricError {
  if (error instanceof BiometricError) return error;
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new BiometricError('Face ID was cancelled.');
  }
  return new BiometricError("Face ID isn't available right now.");
}

/** True once this device has a salary passkey registered. */
export function hasBiometricLock(): boolean {
  return readCredentialId() !== null;
}

/** Whether this browser has a user-verifying built-in authenticator at all. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Creates this device's salary passkey. Prompts Face ID once. */
export async function registerBiometricLock(): Promise<void> {
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Apsara Save' },
        user: {
          id: randomBytes(16),
          name: 'Salary lock',
          displayName: 'Apsara Save salary lock',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256 — Apple's platform authenticator
          { type: 'public-key', alg: -257 }, // RS256 — Windows Hello
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new BiometricError("Face ID setup didn't finish.");
    window.localStorage.setItem(CREDENTIAL_KEY, toBase64(credential.rawId));
  } catch (error) {
    throw describe(error);
  }
}

/** Asks for Face ID against this device's salary passkey. Resolves on success. */
export async function unlockWithBiometric(): Promise<void> {
  const id = readCredentialId();
  if (!id) throw new BiometricError('Set up Face ID first.');
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: fromBase64(id), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    const response = assertion?.response as AuthenticatorAssertionResponse | undefined;
    // Checked explicitly rather than trusting the request option, so a lax
    // authenticator that only tested presence (a tap) cannot open the lock.
    const verified =
      response !== undefined &&
      (new Uint8Array(response.authenticatorData)[FLAGS_OFFSET] & FLAG_USER_VERIFIED) !== 0;
    if (!verified) throw new BiometricError("Face ID didn't verify you.");
  } catch (error) {
    throw describe(error);
  }
}

/** Forgets this device's passkey — e.g. after it was deleted in system settings. */
export function resetBiometricLock(): void {
  try {
    window.localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    // Nothing stored, or storage blocked — either way nothing to forget.
  }
}
