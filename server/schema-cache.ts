export type SchemaCacheEntry<Value> = { schema: Value; expires: number };

export async function fetchWithSchemaCache<Key, Value>(
  cache: Map<Key, SchemaCacheEntry<Value>>,
  key: Key,
  load: (key: Key) => Promise<Value>,
  ttlMs: number,
  now: () => number = Date.now,
): Promise<Value> {
  const cached = cache.get(key);
  if (cached && now() < cached.expires) return cached.schema;

  const schema = await load(key);
  cache.set(key, { schema, expires: now() + ttlMs });
  return schema;
}
