import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface InstagramEncryptedAccessToken {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
  readonly keyVersion: number;
  readonly fingerprint: string;
}

export interface InstagramCredentialBoundary {
  readonly tenantId: string;
  readonly accountId: string;
}

export class InstagramCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramCredentialError';
  }
}

function decodeEncryptionKey(encodedKey: string): Buffer {
  const normalized = encodedKey.trim();
  if (normalized.length === 0) {
    throw new InstagramCredentialError('Instagram credential encryption key is required.');
  }
  const key = Buffer.from(normalized, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== normalized) {
    throw new InstagramCredentialError(
      'Instagram credential encryption key must be exactly 32 bytes encoded as base64.',
    );
  }
  return key;
}

function additionalAuthenticatedData(
  boundary: InstagramCredentialBoundary,
  keyVersion: number,
): Buffer {
  return Buffer.from(
    `instagram-access-token|v:${keyVersion}|tenant:${boundary.tenantId}|account:${boundary.accountId}`,
    'utf8',
  );
}

function decodeField(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    throw new InstagramCredentialError(`Encrypted Instagram ${label} is invalid.`);
  }
  return decoded;
}

export class InstagramCredentialVault {
  private readonly key: Buffer;

  constructor(
    encodedKey: string,
    private readonly keyVersion = 1,
  ) {
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
      throw new InstagramCredentialError('Instagram encryption key version is invalid.');
    }
    this.key = decodeEncryptionKey(encodedKey);
  }

  encrypt(
    boundary: InstagramCredentialBoundary,
    accessToken: string,
  ): InstagramEncryptedAccessToken {
    const token = accessToken.trim();
    if (token.length < 10 || token.length > 8_192 || token !== accessToken) {
      throw new InstagramCredentialError('Instagram access token is invalid.');
    }

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(additionalAuthenticatedData(boundary, this.keyVersion));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.keyVersion,
      fingerprint: createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16),
    };
  }

  decrypt(boundary: InstagramCredentialBoundary, encrypted: InstagramEncryptedAccessToken): string {
    if (encrypted.keyVersion !== this.keyVersion) {
      throw new InstagramCredentialError('Instagram encryption key version is unavailable.');
    }

    try {
      const iv = decodeField(encrypted.iv, 'IV');
      const authTag = decodeField(encrypted.authTag, 'authentication tag');
      const ciphertext = decodeField(encrypted.ciphertext, 'ciphertext');
      if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
        throw new InstagramCredentialError('Encrypted Instagram credential shape is invalid.');
      }

      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(additionalAuthenticatedData(boundary, encrypted.keyVersion));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof InstagramCredentialError) throw error;
      throw new InstagramCredentialError('Instagram access token could not be decrypted.');
    }
  }
}
