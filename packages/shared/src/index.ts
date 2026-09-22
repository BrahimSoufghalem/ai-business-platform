export interface HealthStatus {
  readonly service: string;
  readonly status: 'ok' | 'degraded';
  readonly timestamp: string;
}
