export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  onUnauthorized?: () => void;
}

function extractMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join(' ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  async request<T>(path: string, options: ApiRequestOptions = {}, retry = true): Promise<T> {
    const token = await this.config.getAccessToken();
    const headers: Record<string, string> = {
      'X-Correlation-Id': crypto.randomUUID(),
      ...options.headers,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      const init: RequestInit = {
        method: options.method ?? 'GET',
        headers,
        cache: 'no-store',
      };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      if (options.signal) init.signal = options.signal;
      response = await fetch(`${this.config.baseUrl}${path}`, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'network');
    }

    if (response.status === 401 && retry) {
      this.config.onUnauthorized?.();
      throw new ApiError(401, 'unauthorized');
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as unknown;
      throw new ApiError(
        response.status,
        extractMessage(payload, `Request failed with status ${response.status}.`),
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  get<T>(path: string, options?: ApiRequestOptions) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }
  post<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }
  put<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }
  delete<T>(path: string, options?: ApiRequestOptions) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
}
