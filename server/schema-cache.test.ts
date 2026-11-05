import { describe, expect, it, vi } from 'vitest';

import { fetchWithSchemaCache } from './schema-cache';

describe('schema TTL cache', () => {
  it('reuses a customer schema until its five-minute TTL expires', async () => {
    const load = vi.fn((customerId: string) => Promise.resolve(`schema:${customerId}`));
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_001)
      .mockReturnValueOnce(301_001)
      .mockReturnValueOnce(301_001);
    const cache = new Map<string, { schema: string; expires: number }>();
    const getSchema = (customerId: string) => fetchWithSchemaCache(cache, customerId, load, 300_000, now);

    await expect(getSchema('retailco')).resolves.toBe('schema:retailco');
    await expect(getSchema('retailco')).resolves.toBe('schema:retailco');
    await expect(getSchema('retailco')).resolves.toBe('schema:retailco');

    expect(load).toHaveBeenCalledTimes(2);
  });
});
