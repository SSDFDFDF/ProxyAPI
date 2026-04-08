import { create } from 'zustand';
import { usageApi } from '@/services/api';
import { collectUsageDetails, computeKeyStatsFromDetails, type KeyStats, type UsageDetail } from '@/utils/usage';
import i18n from '@/i18n';
import { ScopedQueryCache } from './serverState/scopedQueryCache';
import { getCurrentSessionScopeKey } from './serverState/sessionScope';

export const USAGE_STATS_STALE_TIME_MS = 240_000;

export type LoadUsageStatsOptions = {
  force?: boolean;
  staleTimeMs?: number;
};

type UsageStatsSnapshot = Record<string, unknown>;
type UsageCacheSnapshot = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  lastRefreshedAt: number;
};

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  scopeKey: string;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  clearUsageStats: () => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });
const createEmptyUsageState = (scopeKey: string = '') => ({
  usage: null,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  lastRefreshedAt: null,
  scopeKey
});

let usageRequestToken = 0;
const USAGE_QUERY_KEY = 'usage';
const usageCache = new ScopedQueryCache<UsageCacheSnapshot>();

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : i18n.t('usage_stats.loading_error');

const hydrateUsageScopeState = (
  scopeKey: string
): Pick<UsageStatsState, 'usage' | 'keyStats' | 'usageDetails' | 'lastRefreshedAt'> => {
  const cached = usageCache.getEntry(scopeKey, USAGE_QUERY_KEY);
  if (!cached) {
    return createEmptyUsageState(scopeKey);
  }

  return {
    usage: cached.data.usage,
    keyStats: cached.data.keyStats,
    usageDetails: cached.data.usageDetails,
    lastRefreshedAt: cached.data.lastRefreshedAt
  };
};

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  ...createEmptyUsageState(),
  loading: false,
  error: null,

  loadUsageStats: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? USAGE_STATS_STALE_TIME_MS;
    const scopeKey = getCurrentSessionScopeKey();
    const state = get();
    const scopeChanged = state.scopeKey !== scopeKey;

    if (scopeChanged) {
      set({
        ...hydrateUsageScopeState(scopeKey),
        loading: false,
        error: null,
        scopeKey
      });
    }

    // 先复用同源 in-flight 请求，避免多个页面同时发起重复 /usage。
    const inFlightRequest = usageCache.getInFlight(scopeKey, USAGE_QUERY_KEY);
    if (inFlightRequest) {
      const requestId = usageRequestToken;
      const snapshot = await inFlightRequest;
      if (requestId !== usageRequestToken || getCurrentSessionScopeKey() !== scopeKey) {
        return;
      }
      set({
        usage: snapshot.usage,
        keyStats: snapshot.keyStats,
        usageDetails: snapshot.usageDetails,
        loading: false,
        error: null,
        lastRefreshedAt: snapshot.lastRefreshedAt,
        scopeKey
      });
      return;
    }

    const fresh = usageCache.isFresh(scopeKey, USAGE_QUERY_KEY, staleTimeMs);

    if (!force && fresh) {
      const snapshot = usageCache.getFreshEntry(scopeKey, USAGE_QUERY_KEY, staleTimeMs)?.data;
      if (snapshot) {
        set({
          usage: snapshot.usage,
          keyStats: snapshot.keyStats,
          usageDetails: snapshot.usageDetails,
          loading: false,
          error: null,
          lastRefreshedAt: snapshot.lastRefreshedAt,
          scopeKey
        });
      }
      return;
    }

    const requestId = (usageRequestToken += 1);
    set({ loading: true, error: null, scopeKey });

    const requestPromise = (async (): Promise<UsageCacheSnapshot> => {
      const usageResponse = await usageApi.getUsage();
      const rawUsage = usageResponse?.usage ?? usageResponse;
      const usage =
        rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;
      const usageDetails = collectUsageDetails(usage);

      return {
        usage,
        keyStats: computeKeyStatsFromDetails(usageDetails),
        usageDetails,
        lastRefreshedAt: Date.now()
      };
    })();

    usageCache.setInFlight(scopeKey, USAGE_QUERY_KEY, requestPromise);

    try {
      const snapshot = await requestPromise;
      if (requestId !== usageRequestToken) return;

      usageCache.setEntry(scopeKey, USAGE_QUERY_KEY, snapshot, snapshot.lastRefreshedAt);

      set({
        usage: snapshot.usage,
        keyStats: snapshot.keyStats,
        usageDetails: snapshot.usageDetails,
        loading: false,
        error: null,
        lastRefreshedAt: snapshot.lastRefreshedAt,
        scopeKey
      });
    } catch (error: unknown) {
      if (requestId !== usageRequestToken) return;
      const message = getErrorMessage(error);
      set({
        loading: false,
        error: message,
        scopeKey
      });
      throw new Error(message);
    } finally {
      usageCache.clearInFlight(scopeKey, USAGE_QUERY_KEY, requestPromise);
    }
  },

  clearUsageStats: () => {
    usageRequestToken += 1;
    usageCache.clear();
    set({
      ...createEmptyUsageState(),
      loading: false,
      error: null
    });
  }
}));
