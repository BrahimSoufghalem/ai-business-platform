import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectStorageConfig {
  readonly endpoint?: string | undefined;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle?: boolean | undefined;
}

export interface UploadTicket {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

export interface StoredObjectMetadata {
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
}

export interface ObjectStorage {
  put(input: {
    readonly objectKey: string;
    readonly contentType: string;
    readonly body: Uint8Array;
  }): Promise<StoredObjectMetadata>;
  createUploadTicket(input: {
    readonly objectKey: string;
    readonly contentType: string;
    readonly expiresInSeconds?: number | undefined;
  }): Promise<UploadTicket>;
  createDownloadUrl(objectKey: string, expiresInSeconds?: number | undefined): Promise<string>;
  head(objectKey: string): Promise<StoredObjectMetadata>;
}

export function createProductMediaObjectKey(input: {
  readonly tenantId: string;
  readonly productId: string;
  readonly mediaId: string;
  readonly filename: string;
}): string {
  const safeFilename = input.filename
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (!safeFilename) throw new Error('A valid filename is required.');
  return `tenants/${input.tenantId}/products/${input.productId}/${input.mediaId}-${safeFilename}`;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: ObjectStorageConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle ?? false,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(input: {
    readonly objectKey: string;
    readonly contentType: string;
    readonly body: Uint8Array;
  }): Promise<StoredObjectMetadata> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
        Body: input.body,
      }),
    );
    return { contentType: input.contentType, sizeBytes: input.body.byteLength };
  }

  async createUploadTicket(input: {
    readonly objectKey: string;
    readonly contentType: string;
    readonly expiresInSeconds?: number | undefined;
  }): Promise<UploadTicket> {
    const expiresIn = input.expiresInSeconds ?? 900;
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
      }),
      { expiresIn },
    );
    return {
      objectKey: input.objectKey,
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  createDownloadUrl(objectKey: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds },
    );
  }

  async head(objectKey: string): Promise<StoredObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
    );
    return {
      contentType: result.ContentType ?? null,
      sizeBytes: result.ContentLength ?? null,
    };
  }
}
