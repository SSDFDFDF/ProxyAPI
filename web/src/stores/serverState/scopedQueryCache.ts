import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { SERVER_STATE_PERSIST_MAX_SCOPES } from '@/utils/constants';

export interface ScopedQueryCacheEntry<TData> {
  data: TData;
  fetchedAt: number;
}

type SerializedScopedQueryCache<TData> = Record<
  string,
  Record<string, ScopedQueryCacheEntry<TData>>
>;

type PersistedScopedQueryCachePayload<TData> = {
  version: 1;
  scopes: SerializedScopedQueryCache<TData>;
};

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

const canUsePersistentStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const sortScopesByFreshness = <TData,>(
  scopes: Array<[string, Record<string, ScopedQueryCacheEntry<TData>>]>
) =>
  scopes.sort(([, leftEntries], [, rightEntries]) => {
    const leftFreshest = Math.max(...Object.values(leftEntries).map((entry) => entry.fetchedAt), 0);
    const rightFreshest = Math.max(...Object.values(rightEntries).map((entry) => entry.fetchedAt), 0);
    return rightFreshest - leftFreshest;
  });

export class ScopedQueryCache<TData> {
  private cache = new Map<string, Map<string, ScopedQueryCacheEntry<TData>>>();
  private inFlight = new Map<string, Map<string, Promise<TData>>>();

  constructor(private readonly storageKey?: string) {
    this.hydrateFromStorage();
  }

  private hydrateFromStorage(): void {
    if (!this.storageKey || !canUsePersistentStorage()) return;

    const stored = obfuscatedStorage.getItem<PersistedScopedQueryCachePayload<TData> | SerializedScopedQueryCache<TData>>(
      this.storageKey
    );
    if (!stored || typeof stored !== 'object') return;

    const scopes =
      'version' in stored && stored.version === 1 && 'scopes' in stored && stored.scopes && typeof stored.scopes === 'object'
        ? stored.scopes
        : (stored as SerializedScopedQueryCache<TData>);

    Object.entries(scopes).forEach(([scopeKey, entries]) => {
      if (!entries || typeof entries !== 'object') return;
      const bucket = new Map<string, ScopedQueryCacheEntry<TData>>();
      Object.entries(entries).forEach(([queryKey, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        const fetchedAt =
          'fetchedAt' in entry && typeof entry.fetchedAt === 'number' ? entry.fetchedAt : null;
        if (fetchedAt === null || !('data' in entry)) return;
        bucket.set(queryKey, {
          data: entry.data as TData,
          fetchedAt,
        });
      });
      if (bucket.size > 0) {
        this.cache.set(scopeKey, bucket);
      }
    });
  }

  private persistToStorage(): void {
    if (!this.storageKey || !canUsePersistentStorage()) return;

    if (this.cache.size === 0) {
      obfuscatedStorage.removeItem(this.storageKey);
      return;
    }

    const serializedEntries = Array.from(this.cache.entries()).reduce<
      Array<[string, Record<string, ScopedQueryCacheEntry<TData>>]>
    >((result, [scopeKey, bucket]) => {
      if (bucket.size === 0) {
        return result;
      }

      const entries: Record<string, ScopedQueryCacheEntry<TData>> = {};
      bucket.forEach((entry, queryKey) => {
        entries[queryKey] = entry;
      });
      if (Object.keys(entries).length > 0) {
        result.push([scopeKey, entries]);
      }
      return result;
    }, []);

    const limitedScopes = sortScopesByFreshness(serializedEntries).slice(0, SERVER_STATE_PERSIST_MAX_SCOPES);
    if (limitedScopes.length === 0) {
      obfuscatedStorage.removeItem(this.storageKey);
      return;
    }

    const payload: PersistedScopedQueryCachePayload<TData> = {
      version: 1,
      scopes: Object.fromEntries(limitedScopes),
    };

    obfuscatedStorage.setItem(this.storageKey, payload);
  }

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
    this.persistToStorage();
    return entry;
  }

  deleteEntry(scopeKey: string, queryKey: string): void {
    const bucket = this.cache.get(scopeKey);
    if (!bucket) return;

    bucket.delete(queryKey);
    cleanupScopeBucket(this.cache, scopeKey);
    this.persistToStorage();
  }

  snapshotScope(scopeKey: string): Map<string, ScopedQueryCacheEntry<TData>> {
    return new Map(this.cache.get(scopeKey) ?? []);
  }

  deleteScope(scopeKey: string): void {
    this.cache.delete(scopeKey);
    this.inFlight.delete(scopeKey);
    this.persistToStorage();
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.persistToStorage();
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
