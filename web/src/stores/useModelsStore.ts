/**
 * 模型列表状态管理（带缓存）
 */

import { create } from 'zustand';
import { modelsApi } from '@/services/api/models';
import { CACHE_EXPIRY_MS } from '@/utils/constants';
import type { ModelInfo } from '@/utils/models';
import { ScopedQueryCache } from './serverState/scopedQueryCache';
import { getCurrentSessionScopeKey } from './serverState/sessionScope';

interface ModelsState {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  scopeKey: string;

  fetchModels: (apiBase: string, apiKey?: string, forceRefresh?: boolean) => Promise<ModelInfo[]>;
  clearCache: () => void;
  isCacheValid: (apiBase: string, apiKey?: string) => boolean;
}

let modelsRequestToken = 0;
const modelsCache = new ScopedQueryCache<ModelInfo[]>();

const buildModelsQueryKey = (apiBase: string, apiKey: string) =>
  JSON.stringify({ apiBase, apiKey });

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  loading: false,
  error: null,
  scopeKey: '',

  fetchModels: async (apiBase, apiKey, forceRefresh = false) => {
    const scopeKey = getCurrentSessionScopeKey();
    const apiKeyScope = apiKey?.trim() || '';
    const queryKey = buildModelsQueryKey(apiBase, apiKeyScope);

    if (get().scopeKey !== scopeKey) {
      set({
        models: [],
        scopeKey,
        error: null,
        loading: false
      });
    }

    // 检查缓存
    if (!forceRefresh) {
      const cached = modelsCache.getFreshEntry(scopeKey, queryKey, CACHE_EXPIRY_MS);
      if (cached) {
        set({
          models: cached.data,
          error: null,
          loading: false,
          scopeKey
        });
        return cached.data;
      }
    }

    const inFlightRequest = modelsCache.getInFlight(scopeKey, queryKey);
    if (inFlightRequest) {
      const requestId = modelsRequestToken;
      const data = await inFlightRequest;
      if (requestId !== modelsRequestToken || getCurrentSessionScopeKey() !== scopeKey) {
        return data;
      }
      set({
        models: data,
        error: null,
        loading: false,
        scopeKey
      });
      return data;
    }

    set({ loading: true, error: null, scopeKey });

    const requestId = (modelsRequestToken += 1);
    const requestPromise = modelsApi.fetchModels(apiBase, apiKeyScope || undefined);
    modelsCache.setInFlight(scopeKey, queryKey, requestPromise);
    try {
      const list = await requestPromise;
      const now = Date.now();

      if (requestId !== modelsRequestToken) {
        return list;
      }

      modelsCache.setEntry(scopeKey, queryKey, list, now);

      set({
        models: list,
        loading: false,
        error: null,
        scopeKey
      });

      return list;
    } catch (error: unknown) {
      if (requestId !== modelsRequestToken) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to fetch models';
      set({
        error: message,
        loading: false,
        models: [],
        scopeKey
      });
      throw error;
    } finally {
      modelsCache.clearInFlight(scopeKey, queryKey, requestPromise);
    }
  },

  clearCache: () => {
    modelsRequestToken += 1;
    modelsCache.clear();
    set({
      models: [],
      loading: false,
      error: null,
      scopeKey: getCurrentSessionScopeKey()
    });
  },

  isCacheValid: (apiBase, apiKey) => {
    const scopeKey = getCurrentSessionScopeKey();
    if (get().scopeKey !== scopeKey) return false;
    const apiKeyScope = apiKey?.trim() || '';
    const queryKey = buildModelsQueryKey(apiBase, apiKeyScope);
    return modelsCache.isFresh(scopeKey, queryKey, CACHE_EXPIRY_MS);
  }
}));
