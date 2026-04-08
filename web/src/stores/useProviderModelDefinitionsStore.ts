import { create } from 'zustand';
import { authFilesApi } from '@/services/api';
import { CACHE_EXPIRY_MS, STORAGE_KEY_SERVER_STATE_PROVIDER_MODELS } from '@/utils/constants';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { ScopedQueryCache } from './serverState/scopedQueryCache';
import { getCurrentSessionScopeKey } from './serverState/sessionScope';

export type ProviderModelsError = 'unsupported' | 'failed' | null;
export type LoadProviderModelDefinitionsOptions = {
  force?: boolean;
  staleTimeMs?: number;
};

type ProviderModelsSnapshot = {
  models: AuthFileModelItem[];
  error: ProviderModelsError;
  lastRefreshedAt: number;
};

type ProviderModelDefinitionsState = {
  scopeKey: string;
  modelsByProvider: Record<string, AuthFileModelItem[]>;
  errorsByProvider: Record<string, ProviderModelsError>;
  loadingByProvider: Record<string, boolean>;
  loadProviderModels: (
    provider: string,
    options?: LoadProviderModelDefinitionsOptions
  ) => Promise<AuthFileModelItem[]>;
  clearProviderModels: () => void;
};

const providerModelDefinitionsCache = new ScopedQueryCache<ProviderModelsSnapshot>(
  STORAGE_KEY_SERVER_STATE_PROVIDER_MODELS
);
const providerModelsRequestTokens = new Map<string, number>();

const normalizeProvider = (value: string) => String(value ?? '').trim().toLowerCase();
const buildProviderRequestKey = (scopeKey: string, provider: string) => `${scopeKey}::${provider}`;

const createEmptyProviderDefinitionsState = (scopeKey: string = '') => ({
  scopeKey,
  modelsByProvider: {} as Record<string, AuthFileModelItem[]>,
  errorsByProvider: {} as Record<string, ProviderModelsError>,
  loadingByProvider: {} as Record<string, boolean>
});

const hydrateProviderDefinitionsScopeState = (
  scopeKey: string
): Pick<ProviderModelDefinitionsState, 'modelsByProvider' | 'errorsByProvider'> => {
  const snapshot = providerModelDefinitionsCache.snapshotScope(scopeKey);
  const modelsByProvider: Record<string, AuthFileModelItem[]> = {};
  const errorsByProvider: Record<string, ProviderModelsError> = {};

  snapshot.forEach((entry, provider) => {
    modelsByProvider[provider] = entry.data.models;
    errorsByProvider[provider] = entry.data.error;
  });

  return {
    modelsByProvider,
    errorsByProvider
  };
};

export const useProviderModelDefinitionsStore = create<ProviderModelDefinitionsState>((set, get) => ({
  ...createEmptyProviderDefinitionsState(),

  loadProviderModels: async (provider, options = {}) => {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) return [];

    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? CACHE_EXPIRY_MS;
    const scopeKey = getCurrentSessionScopeKey();
    const requestKey = buildProviderRequestKey(scopeKey, normalizedProvider);
    const state = get();

    if (state.scopeKey !== scopeKey) {
      set({
        ...hydrateProviderDefinitionsScopeState(scopeKey),
        loadingByProvider: {},
        scopeKey
      });
    }

    const inFlightRequest = providerModelDefinitionsCache.getInFlight(scopeKey, normalizedProvider);
    if (inFlightRequest) {
      const requestId = providerModelsRequestTokens.get(requestKey) ?? 0;
      const snapshot = await inFlightRequest;
      if (
        (providerModelsRequestTokens.get(requestKey) ?? 0) !== requestId ||
        getCurrentSessionScopeKey() !== scopeKey
      ) {
        return snapshot.models;
      }
      set((current) => ({
        modelsByProvider: {
          ...current.modelsByProvider,
          [normalizedProvider]: snapshot.models
        },
        errorsByProvider: {
          ...current.errorsByProvider,
          [normalizedProvider]: snapshot.error
        },
        loadingByProvider: {
          ...current.loadingByProvider,
          [normalizedProvider]: false
        },
        scopeKey
      }));
      return snapshot.models;
    }

    if (!force) {
      const cached = providerModelDefinitionsCache.getFreshEntry(
        scopeKey,
        normalizedProvider,
        staleTimeMs
      )?.data;
      if (cached) {
        set((current) => ({
          modelsByProvider: {
            ...current.modelsByProvider,
            [normalizedProvider]: cached.models
          },
          errorsByProvider: {
            ...current.errorsByProvider,
            [normalizedProvider]: cached.error
          },
          loadingByProvider: {
            ...current.loadingByProvider,
            [normalizedProvider]: false
          },
          scopeKey
        }));
        return cached.models;
      }
    }

    const requestId = (providerModelsRequestTokens.get(requestKey) ?? 0) + 1;
    providerModelsRequestTokens.set(requestKey, requestId);
    set((current) => ({
      loadingByProvider: {
        ...current.loadingByProvider,
        [normalizedProvider]: true
      },
      scopeKey
    }));

    const requestPromise = (async (): Promise<ProviderModelsSnapshot> => {
      try {
        return {
          models: await authFilesApi.getModelDefinitions(normalizedProvider),
          error: null,
          lastRefreshedAt: Date.now()
        };
      } catch (error: unknown) {
        const status =
          typeof error === 'object' && error !== null && 'status' in error
            ? (error as { status?: unknown }).status
            : undefined;
        if (status === 404) {
          return {
            models: [],
            error: 'unsupported',
            lastRefreshedAt: Date.now()
          };
        }
        throw error;
      }
    })();

    providerModelDefinitionsCache.setInFlight(scopeKey, normalizedProvider, requestPromise);

    try {
      const snapshot = await requestPromise;
      if (providerModelsRequestTokens.get(requestKey) !== requestId) {
        return snapshot.models;
      }

      providerModelDefinitionsCache.setEntry(
        scopeKey,
        normalizedProvider,
        snapshot,
        snapshot.lastRefreshedAt
      );
      set((current) => ({
        modelsByProvider: {
          ...current.modelsByProvider,
          [normalizedProvider]: snapshot.models
        },
        errorsByProvider: {
          ...current.errorsByProvider,
          [normalizedProvider]: snapshot.error
        },
        loadingByProvider: {
          ...current.loadingByProvider,
          [normalizedProvider]: false
        },
        scopeKey
      }));
      return snapshot.models;
    } catch (error) {
      if (providerModelsRequestTokens.get(requestKey) === requestId) {
        set((current) => ({
          modelsByProvider: {
            ...current.modelsByProvider,
            [normalizedProvider]: []
          },
          errorsByProvider: {
            ...current.errorsByProvider,
            [normalizedProvider]: 'failed'
          },
          loadingByProvider: {
            ...current.loadingByProvider,
            [normalizedProvider]: false
          },
          scopeKey
        }));
      }
      throw error;
    } finally {
      providerModelDefinitionsCache.clearInFlight(scopeKey, normalizedProvider, requestPromise);
    }
  },

  clearProviderModels: () => {
    providerModelsRequestTokens.clear();
    providerModelDefinitionsCache.clear();
    set(createEmptyProviderDefinitionsState());
  }
}));
