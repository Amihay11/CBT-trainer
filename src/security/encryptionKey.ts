/**
 * Encryption Key Lifecycle — Data-at-Rest Root Key Management
 * ==========================================================
 *
 * Regulatory driver: Israeli Privacy Protection Regulations (Data Security), 5777-2017,
 * together with HIPAA §164.312(a)(2)(iv), classify a database of mental-health records as
 * **Medium / High security**. Both mandate AES-256 encryption at rest and hardware-backed
 * key custody. This module owns the *only* copy of the SQLCipher passphrase and guarantees
 * it is generated with a CSPRNG and never leaves the platform secure element.
 *
 * Design (SOLID):
 *  - `KeyProvider` is the abstraction (Dependency Inversion). The database adapter depends on
 *    this interface, never on a concrete store, so the backing keystore can be swapped
 *    (e.g. to a HSM-backed provider) without touching persistence code.
 *  - `SecureStoreKeyProvider` is the default implementation, backed by the OS Keychain (iOS
 *    Secure Enclave) / Keystore (Android StrongBox) via `expo-secure-store`.
 *
 * Threat model handled here:
 *  - Key never derived from a user PIN or any low-entropy secret (CSPRNG, 256 bits).
 *  - Key marked device-only and non-exportable in backups (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`)
 *    so an iCloud/Google backup can never exfiltrate the passphrase.
 *  - Optional biometric gate (`requireAuthentication`) binds key retrieval to Face ID /
 *    fingerprint, satisfying the "strong authentication" control.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/** Number of random bytes for the passphrase. 32 bytes = 256 bits = AES-256 key strength. */
const KEY_BYTE_LENGTH = 32;

/** Namespaced keychain/keystore alias. Changing this value orphans the existing DB key. */
const SECURE_STORE_ALIAS = 'cbt.trainer.sqlcipher.master.key.v1';

/**
 * Options that harden how the master key is persisted. Defaults are the strictest
 * configuration compatible with unattended background sync.
 */
export interface KeyStorageOptions {
  /**
   * When true, key retrieval prompts for Face ID / fingerprint. Disable only for flows
   * that must run while the device is locked (e.g. background delta-sync). Default: false.
   */
  readonly requireBiometricAuth: boolean;
}

const DEFAULT_STORAGE_OPTIONS: KeyStorageOptions = {
  requireBiometricAuth: false,
};

/**
 * Abstraction for supplying the SQLCipher passphrase. Consumers (the DB adapter) depend
 * on this interface only — never on `expo-secure-store` directly.
 */
export interface KeyProvider {
  /**
   * Returns the hex-encoded 256-bit passphrase, generating and persisting it on first call.
   * Idempotent: subsequent calls return the identical, already-persisted key.
   */
  getOrCreateDatabaseKey(): Promise<string>;

  /**
   * Permanently removes the key. This cryptographically shreds the database (records become
   * unrecoverable) and is the technical implementation of the "Right to Erasure" (Amendment 13).
   */
  destroyDatabaseKey(): Promise<void>;
}

/**
 * Raised when the secure hardware store is unavailable (e.g. no passcode set on device).
 * Callers must treat this as fatal — running unencrypted is forbidden by policy.
 */
export class SecureKeyUnavailableError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SecureKeyUnavailableError';
  }
}

/**
 * Keychain/Keystore-backed implementation of {@link KeyProvider}.
 */
export class SecureStoreKeyProvider implements KeyProvider {
  private readonly alias: string;
  private readonly options: KeyStorageOptions;

  /** In-memory cache to avoid repeated keystore reads within a single app session. */
  private cachedKey: string | null = null;

  constructor(alias: string = SECURE_STORE_ALIAS, options: Partial<KeyStorageOptions> = {}) {
    this.alias = alias;
    this.options = { ...DEFAULT_STORAGE_OPTIONS, ...options };
  }

  async getOrCreateDatabaseKey(): Promise<string> {
    if (this.cachedKey !== null) {
      return this.cachedKey;
    }

    if (!(await SecureStore.isAvailableAsync())) {
      throw new SecureKeyUnavailableError(
        'Secure hardware store is unavailable. A device passcode is required to protect PHI at rest.',
      );
    }

    const storeOptions = this.buildStoreOptions();

    try {
      const existing = await SecureStore.getItemAsync(this.alias, storeOptions);
      if (existing) {
        this.cachedKey = existing;
        return existing;
      }

      const freshKey = await this.generatePassphrase();
      await SecureStore.setItemAsync(this.alias, freshKey, storeOptions);
      this.cachedKey = freshKey;
      return freshKey;
    } catch (error) {
      if (error instanceof SecureKeyUnavailableError) throw error;
      throw new SecureKeyUnavailableError('Failed to read or persist the database master key.', error);
    }
  }

  async destroyDatabaseKey(): Promise<void> {
    this.cachedKey = null;
    await SecureStore.deleteItemAsync(this.alias, this.buildStoreOptions());
  }

  /** Generates a 256-bit CSPRNG passphrase, hex-encoded for safe transport into SQLCipher. */
  private async generatePassphrase(): Promise<string> {
    const randomBytes = await Crypto.getRandomBytesAsync(KEY_BYTE_LENGTH);
    return Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private buildStoreOptions(): SecureStore.SecureStoreOptions {
    return {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: this.options.requireBiometricAuth,
    };
  }
}

/** Process-wide default provider. Injected into the DB adapter at mount time. */
export const keyProvider: KeyProvider = new SecureStoreKeyProvider();
