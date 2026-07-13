import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns an "ok" payload with service name, uptime, and a parseable timestamp', () => {
    const result = new HealthController().health();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('martinrea-ap-ingestion');
    expect(result.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(new Date(result.time).getTime())).toBe(true);
  });
});
