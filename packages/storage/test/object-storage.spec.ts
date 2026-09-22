import { describe, expect, it } from 'vitest';
import { createProductMediaObjectKey, S3ObjectStorage } from '../src/object-storage.js';

describe('object storage', () => {
  it('creates tenant-prefixed product media keys', () => {
    expect(
      createProductMediaObjectKey({
        tenantId: 'tenant-1',
        productId: 'product-1',
        mediaId: 'media-1',
        filename: 'Front photo (black).png',
      }),
    ).toBe('tenants/tenant-1/products/product-1/media-1-Front-photo-black-.png');
  });

  it('creates a locally signed S3-compatible upload URL', async () => {
    const storage = new S3ObjectStorage({
      endpoint: 'https://storage.example.test',
      region: 'auto',
      bucket: 'catalog',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      forcePathStyle: true,
    });
    const ticket = await storage.createUploadTicket({
      objectKey: 'tenants/t/products/p/media.png',
      contentType: 'image/png',
      expiresInSeconds: 60,
    });
    expect(ticket.uploadUrl).toContain('X-Amz-Signature=');
    expect(ticket.objectKey).toBe('tenants/t/products/p/media.png');
  });
});
