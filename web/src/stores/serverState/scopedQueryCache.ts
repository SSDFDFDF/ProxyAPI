export interface ScopedQueryCacheEntry<TData> {
  data: TData;
  fetchedAt: number;
}

const ensureScopeBucket = <TValue>(
  container: Map<string, Map<string, TValue>>,
  scopeKey: string
): Map<string, TValue> => {
  const existing = container.get(scopeKey);
  if (existing) return existing;

  const next = new Map<string, TValue>();
  container.set(scopeKey, next);
  return next;
};

const cleanupScopeBucket = <TValue>(
  container: Map<string, Map<string, TValue>>,
  scopeKey: string
) => {
  const bucket = container.get(scopeKey);
  if (!bucket || bucket.size > 0) return;
  container.delete(scopeKey);
};

export class ScopedQueryCache<TData> {
  private cache = new Map<string, Map<string, ScopedQueryCacheEntry<TData>>>();
  private inFlight = new Map<string, Map<string, Promise<TData>>>();

  getEntry(scopeKey: string, queryKey: string): ScopedQueryCacheEntry<TData> | null {
    return this.cache.get(scopeKey)?.get(queryKey) ?? null;
  }

  getFreshEntry(
    scopeKey: string,
    queryKey: string,
    staleTimeMs: number
  ): ScopedQueryCacheEntry<TData> | null {
    const entry = this.getEntry(scopeKey, queryKey);
    if (!entry) return null;
    return Date.now() - entry.fetchedAt < staleTimeMs ? entry : null;
  }

  isFresh(scopeKey: string, queryKey: string, staleTimeMs: number): boolean {
    return this.getFreshEntry(scopeKey, queryKey, staleTimeMs) !== null;
  }

  setEntry(
    scopeKey: string,
    queryKey: string,
    data: TData,
    fetchedAt: number = Date.now()
  ): ScopedQueryCacheEntry<TData> {
    const entry = { data, fetchedAt };
    ensureScopeBucket(this.cache, scopeKey).set(queryKey, entry);
    return entry;
  }

  deleteEntry(scopeKey: string, queryKey: string): void {
    const bucket = this.cache.get(scopeKey);
    if (!bucket) return;

    bucket.delete(queryKey);
    cleanupScopeBucket(this.cache, scopeKey);
  }

  snapshotScope(scopeKey: string): Map<string, ScopedQueryCacheEntry<TData>> {
    return new Map(this.cache.get(scopeKey) ?? []);
  }

  deleteScope(scopeKey: string): void {
    this.cache.delete(scopeKey);
    this.inFlight.delete(scopeKey);
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  getInFlight(scopeKey: string, queryKey: string): Promise<TData> | null {
    return this.inFlight.get(scopeKey)?.get(queryKey) ?? null;
  }

  setInFlight(scopeKey: string, queryKey: string, promise: Promise<TData>): void {
    ensureScopeBucket(this.inFlight, scopeKey).set(queryKey, promise);
  }

  clearInFlight(
    scopeKey: string,
    queryKey: string,
    expectedPromise?: Promise<TData>
  ): void {
    const bucket = this.inFlight.get(scopeKey);
    if (!bucket) return;

    if (expectedPromise && bucket.get(queryKey) !== expectedPromise) {
      return;
    }

    bucket.delete(queryKey);
    cleanupScopeBucket(this.inFlight, scopeKey);
  }
}
