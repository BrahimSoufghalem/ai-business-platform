import { Injectable } from '@nestjs/common';
import { S3ObjectStorage, type ObjectStorage } from '@ai-business/storage';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for media operations.`);
  return value;
}

@Injectable()
export class StorageService {
  private configured: ObjectStorage | undefined;

  get client(): ObjectStorage {
    this.configured ??= new S3ObjectStorage({
      endpoint: process.env.S3_ENDPOINT,
      region: requiredEnvironment('S3_REGION'),
      bucket: requiredEnvironment('S3_BUCKET'),
      accessKeyId: requiredEnvironment('S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnvironment('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
    return this.configured;
  }
}
