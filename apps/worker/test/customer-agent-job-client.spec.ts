import { describe, expect, it, vi } from 'vitest';
import { CustomerAgentJobClient } from '../src/customer-agent-job-client.js';

const workerToken = 'worker-token-with-at-least-thirty-two-characters';

describe('CustomerAgentJobClient', () => {
  it('calls the protected processor without putting the token in the URL or body', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 'completed', jobId: 'job-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new CustomerAgentJobClient({
      apiBaseUrl: 'https://api.example.test',
      workerId: 'worker:test',
      workerToken,
      fetchImplementation,
    });

    await expect(client.processNext()).resolves.toBe('completed');
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.example.test/api/internal/customer-agent-jobs/process-next',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'X-Worker-Id': 'worker:test',
          'X-Worker-Token': workerToken,
        },
      }),
    );
    const [, request] = fetchImplementation.mock.calls[0] ?? [];
    expect(request?.body).toBeUndefined();
  });

  it('rejects insecure non-local processor URLs', () => {
    expect(
      () =>
        new CustomerAgentJobClient({
          apiBaseUrl: 'http://api.example.test',
          workerId: 'worker:test',
          workerToken,
        }),
    ).toThrow('Internal API base URL must use HTTPS.');
  });

  it('rejects an invalid processor response', async () => {
    const client = new CustomerAgentJobClient({
      apiBaseUrl: 'http://127.0.0.1:3001',
      workerId: 'worker:test',
      workerToken,
      fetchImplementation: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'unknown' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });

    await expect(client.processNext()).rejects.toThrow(
      'Customer-agent processor returned an invalid status.',
    );
  });
});
