import { Readable } from 'node:stream';
import { verifyInstagramWebhookSignature } from '@ai-business/integrations';
import type { FastifyInstance } from 'fastify';

const WEBHOOK_PATH = '/api/webhooks/instagram';
const DEFAULT_MAX_BYTES = 262_144;
const ABSOLUTE_MAX_BYTES = 1_048_576;

class InstagramWebhookRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InstagramWebhookRequestError';
  }
}

function webhookMaxBytes(): number {
  const configured = Number(process.env.INSTAGRAM_WEBHOOK_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured >= 1_024 && configured <= ABSOLUTE_MAX_BYTES
    ? configured
    : DEFAULT_MAX_BYTES;
}

function appSecret(): string {
  const secret = process.env.INSTAGRAM_APP_SECRET?.trim() ?? '';
  if (secret.length < 16) {
    throw new InstagramWebhookRequestError(
      503,
      'INSTAGRAM_WEBHOOK_NOT_CONFIGURED',
      'Instagram webhook is not configured.',
    );
  }
  return secret;
}

function signatureHeader(value: string | string[] | undefined): string {
  if (typeof value !== 'string') {
    throw new InstagramWebhookRequestError(
      401,
      'INSTAGRAM_SIGNATURE_REQUIRED',
      'Instagram webhook signature is required.',
    );
  }
  return value;
}

export function registerInstagramWebhookSecurity(instance: FastifyInstance): void {
  instance.addHook('preParsing', async (request, _reply, payload) => {
    const path = request.url.split('?', 1)[0];
    if (request.method !== 'POST' || path !== WEBHOOK_PATH) return payload;

    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new InstagramWebhookRequestError(
        415,
        'INSTAGRAM_CONTENT_TYPE_INVALID',
        'Instagram webhook content type must be application/json.',
      );
    }

    const chunks: Buffer[] = [];
    let byteLength = 0;
    const maxBytes = webhookMaxBytes();
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.length;
      if (byteLength > maxBytes) {
        throw new InstagramWebhookRequestError(
          413,
          'INSTAGRAM_WEBHOOK_TOO_LARGE',
          'Instagram webhook body is too large.',
        );
      }
      chunks.push(buffer);
    }

    const rawBody = Buffer.concat(chunks, byteLength);
    const signature = signatureHeader(request.headers['x-hub-signature-256']);
    if (!verifyInstagramWebhookSignature(rawBody, signature, appSecret())) {
      throw new InstagramWebhookRequestError(
        401,
        'INSTAGRAM_SIGNATURE_INVALID',
        'Instagram webhook signature is invalid.',
      );
    }

    const replay = Readable.from(rawBody) as Readable & { receivedEncodedLength: number };
    replay.receivedEncodedLength = rawBody.length;
    return replay;
  });
}
