import { create } from 'zustand';
import { authFilesApi } from '@/services/api';
import {
  CACHE_EXPIRY_MS,
  STORAGE_KEY_SERVER_STATE_OAUTH_EXCLUDED,
  STORAGE_KEY_SERVER_STATE_OAUTH_MODEL_ALIAS,
} from '@/utils/constants';
import type { OAuthModelAliasEntry } from '@/types';
import { ScopedQueryCache } from './serverState/scopedQueryCache';
import { getCurrentSessionScopeKey } from './serverState/sessionScope';

export type UnsupportedError = 'unsupported' | 'failed' | null;

export type LoadOauthDataOptions = {
  force?: boolean;
  staleTimeMs?: number;
};

type OauthExcludedSnapshot = {
  data: Record<string, string[]>;
  error: UnsupportedError;
  lastRefreshedAt: number;
};

type OauthModelAliasSnapshot = {
  data: Record<string, OAuthModelAliasEntry[]>;
  error: UnsupportedError;
  lastRefreshedAt: number;
};

type OauthExcludedUpdater =
  | Record<string, string[]>
  | ((prev: Record<string, string[]>) => Record<string, string[]>);

type OauthModelAliasUpdater =
  | Record<string, OAuthModelAliasEntry[]>
  | ((
      prev: Record<string, OAuthModelAliasEntry[]>
    ) => Record<string, OAuthModelAliasEntry[]>);

type AuthFilesOauthState = {
  scopeKey: string;
  excluded: Record<string, string[]>;
  excludedError: UnsupportedError;
  excludedLoading: boolean;
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  modelAliasError: UnsupportedError;
  modelAliasLoading: boolean;
  loadExcluded: (options?: LoadOauthDataOptions) => Promise<Record<string, string[]>>;
  loadModelAlias: (options?: LoadOauthDataOptions) => Promise<Record<string, OAuthModelAliasEntry[]>>;
  setExcludedSnapshot: (
    data: Record<string, string[]>,
    error?: UnsupportedError,
    fetchedAt?: number,
    scopeKey?: string
  ) => void;
  updateExcludedSnapshot: (updater: OauthExcludedUpdater, error?: UnsupportedError, scopeKey?: string) => void;
  setModelAliasSnapshot: (
    data: Record<string, OAuthModelAliasEntry[]>,
    error?: UnsupportedError,
    fetchedAt?: number,
    scopeKey?: string
  ) => void;
  updateModelAliasSnapshot: (
    updater: OauthModelAliasUpdater,
    error?: UnsupportedError,
    scopeKey?: string
  ) => void;
  invalidateExcluded: (scopeKey?: string) => void;
  invalidateModelAlias: (scopeKey?: string) => void;
  clearOauthState: () => void;
};

const OAUTH_EXCLUDED_QUERY_KEY = 'oauth-excluded-models';
const OAUTH_MODEL_ALIAS_QUERY_KEY = 'oauth-model-alias';

const excludedCache = new ScopedQueryCache<OauthExcludedSnapshot>(STORAGE_KEY_SERVER_STATE_OAUTH_EXCLUDED);
const modelAliasCache = new ScopedQueryCache<OauthModelAliasSnapshot>(
  STORAGE_KEY_SERVER_STATE_OAUTH_MODEL_ALIAS
);

let oauthExcludedRequestToken = 0;
let oauthModelAliasRequestToken = 0;

const createEmptyOauthState = (scopeKey: string = '') => ({
  scopeKey,
  excluded: {},
  excludedError: null as UnsupportedError,
  modelAlias: {},
  modelAliasError: null as UnsupportedError
});

const resolveUpdater = <T,>(updater: T | ((prev: T) => T), prev: T): T =>
  typeof updater === 'function' ? (updater as (value: T) => T)(prev) : updater;

const getCurrentExcludedSnapshot = (
  state: AuthFilesOauthState,
  scopeKey: string
): OauthExcludedSnapshot => {
  if (state.scopeKey === scopeKey) {
    return {
      data: state.excluded,
      error: state.excludedError,
      lastRefreshedAt: Date.now()
    };
  }

  return (
    excludedCache.getEntry(scopeKey, OAUTH_EXCLUDED_QUERY_KEY)?.data ?? {
      data: {},
      error: null,
      lastRefreshedAt: Date.now()
    }
  );
};

const getCurrentModelAliasSnapshot = (
  state: AuthFilesOauthState,
  scopeKey: string
): OauthModelAliasSnapshot => {
  if (state.scopeKey === scopeKey) {
    return {
      data: state.modelAlias,
      error: state.modelAliasError,
      lastRefreshedAt: Date.now()
    };
  }

  return (
    modelAliasCache.getEntry(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY)?.data ?? {
      data: {},
      error: null,
      lastRefreshedAt: Date.now()
    }
  );
};

const hydrateExcludedScopeState = (
  scopeKey: string
): Pick<AuthFilesOauthState, 'excluded' | 'excludedError'> => {
  const cached = excludedCache.getEntry(scopeKey, OAUTH_EXCLUDED_QUERY_KEY);
  if (!cached) {
    return {
      excluded: {},
      excludedError: null
    };
  }

  return {
    excluded: cached.data.data,
    excludedError: cached.data.error
  };
};

const hydrateModelAliasScopeState = (
  scopeKey: string
): Pick<AuthFilesOauthState, 'modelAlias' | 'modelAliasError'> => {
  const cached = modelAliasCache.getEntry(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY);
  if (!cached) {
    return {
      modelAlias: {},
      modelAliasError: null
    };
  }

  return {
    modelAlias: cached.data.data,
    modelAliasError: cached.data.error
  };
};

export const useAuthFilesOauthStore = create<AuthFilesOauthState>((set, get) => ({
  ...createEmptyOauthState(),
  excludedLoading: false,
  modelAliasLoading: false,

  loadExcluded: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? CACHE_EXPIRY_MS;
    const scopeKey = getCurrentSessionScopeKey();
    const state = get();

    if (state.scopeKey !== scopeKey) {
      set({
        ...hydrateExcludedScopeState(scopeKey),
        ...hydrateModelAliasScopeState(scopeKey),
        scopeKey,
        excludedLoading: false,
        modelAliasLoading: false
      });
    }

    const inFlightRequest = excludedCache.getInFlight(scopeKey, OAUTH_EXCLUDED_QUERY_KEY);
    if (inFlightRequest) {
      const requestId = oauthExcludedRequestToken;
      const snapshot = await inFlightRequest;
      if (requestId !== oauthExcludedRequestToken || getCurrentSessionScopeKey() !== scopeKey) {
        return snapshot.data;
      }
      set({
        excluded: snapshot.data,
        excludedError: snapshot.error,
        excludedLoading: false,
        scopeKey
      });
      return snapshot.data;
    }

    if (!force) {
      const cached = excludedCache.getFreshEntry(
        scopeKey,
        OAUTH_EXCLUDED_QUERY_KEY,
        staleTimeMs
      )?.data;
      if (cached) {
        set({
          excluded: cached.data,
          excludedError: cached.error,
          excludedLoading: false,
          scopeKey
        });
        return cached.data;
      }
    }

    const requestId = (oauthExcludedRequestToken += 1);
    set({ excludedLoading: true, scopeKey });

    const requestPromise = (async (): Promise<OauthExcludedSnapshot> => {
      try {
        return {
          data: await authFilesApi.getOauthExcludedModels(),
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
            data: {},
            error: 'unsupported',
            lastRefreshedAt: Date.now()
          };
        }
        throw error;
      }
    })();

    excludedCache.setInFlight(scopeKey, OAUTH_EXCLUDED_QUERY_KEY, requestPromise);

    try {
      const snapshot = await requestPromise;
      if (requestId !== oauthExcludedRequestToken) {
        return snapshot.data;
      }

      excludedCache.setEntry(
        scopeKey,
        OAUTH_EXCLUDED_QUERY_KEY,
        snapshot,
        snapshot.lastRefreshedAt
      );
      set({
        excluded: snapshot.data,
        excludedError: snapshot.error,
        excludedLoading: false,
        scopeKey
      });
      return snapshot.data;
    } catch (error) {
      if (requestId === oauthExcludedRequestToken) {
        set({
          excludedLoading: false,
          excludedError: 'failed',
          scopeKey
        });
      }
      throw error;
    } finally {
      excludedCache.clearInFlight(scopeKey, OAUTH_EXCLUDED_QUERY_KEY, requestPromise);
    }
  },

  loadModelAlias: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? CACHE_EXPIRY_MS;
    const scopeKey = getCurrentSessionScopeKey();
    const state = get();

    if (state.scopeKey !== scopeKey) {
      set({
        ...hydrateExcludedScopeState(scopeKey),
        ...hydrateModelAliasScopeState(scopeKey),
        scopeKey,
        excludedLoading: false,
        modelAliasLoading: false
      });
    }

    const inFlightRequest = modelAliasCache.getInFlight(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY);
    if (inFlightRequest) {
      const requestId = oauthModelAliasRequestToken;
      const snapshot = await inFlightRequest;
      if (requestId !== oauthModelAliasRequestToken || getCurrentSessionScopeKey() !== scopeKey) {
        return snapshot.data;
      }
      set({
        modelAlias: snapshot.data,
        modelAliasError: snapshot.error,
        modelAliasLoading: false,
        scopeKey
      });
      return snapshot.data;
    }

    if (!force) {
      const cached = modelAliasCache.getFreshEntry(
        scopeKey,
        OAUTH_MODEL_ALIAS_QUERY_KEY,
        staleTimeMs
      )?.data;
      if (cached) {
        set({
          modelAlias: cached.data,
          modelAliasError: cached.error,
          modelAliasLoading: false,
          scopeKey
        });
        return cached.data;
      }
    }

    const requestId = (oauthModelAliasRequestToken += 1);
    set({ modelAliasLoading: true, scopeKey });

    const requestPromise = (async (): Promise<OauthModelAliasSnapshot> => {
      try {
        return {
          data: await authFilesApi.getOauthModelAlias(),
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
            data: {},
            error: 'unsupported',
            lastRefreshedAt: Date.now()
          };
        }
        throw error;
      }
    })();

    modelAliasCache.setInFlight(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY, requestPromise);

    try {
      const snapshot = await requestPromise;
      if (requestId !== oauthModelAliasRequestToken) {
        return snapshot.data;
      }

      modelAliasCache.setEntry(
        scopeKey,
        OAUTH_MODEL_ALIAS_QUERY_KEY,
        snapshot,
        snapshot.lastRefreshedAt
      );
      set({
        modelAlias: snapshot.data,
        modelAliasError: snapshot.error,
        modelAliasLoading: false,
        scopeKey
      });
      return snapshot.data;
    } catch (error) {
      if (requestId === oauthModelAliasRequestToken) {
        set({
          modelAliasLoading: false,
          modelAliasError: 'failed',
          scopeKey
        });
      }
      throw error;
    } finally {
      modelAliasCache.clearInFlight(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY, requestPromise);
    }
  },

  setExcludedSnapshot: (data, error = null, fetchedAt = Date.now(), scopeKey = getCurrentSessionScopeKey()) => {
    const snapshot: OauthExcludedSnapshot = { data, error, lastRefreshedAt: fetchedAt };
    excludedCache.setEntry(scopeKey, OAUTH_EXCLUDED_QUERY_KEY, snapshot, fetchedAt);
    set((state) => {
      if (state.scopeKey !== scopeKey) {
        return state;
      }
      return {
        excluded: data,
        excludedError: error,
        excludedLoading: false,
        scopeKey
      };
    });
  },

  updateExcludedSnapshot: (updater, error = null, scopeKey = getCurrentSessionScopeKey()) => {
    oauthExcludedRequestToken += 1;
    excludedCache.clearInFlight(scopeKey, OAUTH_EXCLUDED_QUERY_KEY);
    set((state) => {
      const base = getCurrentExcludedSnapshot(state, scopeKey);
      const nextData = resolveUpdater(updater, base.data);
      const nextSnapshot: OauthExcludedSnapshot = {
        data: nextData,
        error,
        lastRefreshedAt: Date.now()
      };
      excludedCache.setEntry(scopeKey, OAUTH_EXCLUDED_QUERY_KEY, nextSnapshot, nextSnapshot.lastRefreshedAt);

      if (state.scopeKey !== scopeKey) {
        return state;
      }

      return {
        excluded: nextData,
        excludedError: nextSnapshot.error,
        excludedLoading: false,
        scopeKey
      };
    });
  },

  setModelAliasSnapshot: (
    data,
    error = null,
    fetchedAt = Date.now(),
    scopeKey = getCurrentSessionScopeKey()
  ) => {
    const snapshot: OauthModelAliasSnapshot = { data, error, lastRefreshedAt: fetchedAt };
    modelAliasCache.setEntry(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY, snapshot, fetchedAt);
    set((state) => {
      if (state.scopeKey !== scopeKey) {
        return state;
      }
      return {
        modelAlias: data,
        modelAliasError: error,
        modelAliasLoading: false,
        scopeKey
      };
    });
  },

  updateModelAliasSnapshot: (updater, error = null, scopeKey = getCurrentSessionScopeKey()) => {
    oauthModelAliasRequestToken += 1;
    modelAliasCache.clearInFlight(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY);
    set((state) => {
      const base = getCurrentModelAliasSnapshot(state, scopeKey);
      const nextData = resolveUpdater(updater, base.data);
      const nextSnapshot: OauthModelAliasSnapshot = {
        data: nextData,
        error,
        lastRefreshedAt: Date.now()
      };
      modelAliasCache.setEntry(
        scopeKey,
        OAUTH_MODEL_ALIAS_QUERY_KEY,
        nextSnapshot,
        nextSnapshot.lastRefreshedAt
      );

      if (state.scopeKey !== scopeKey) {
        return state;
      }

      return {
        modelAlias: nextData,
        modelAliasError: nextSnapshot.error,
        modelAliasLoading: false,
        scopeKey
      };
    });
  },

  invalidateExcluded: (scopeKey = getCurrentSessionScopeKey()) => {
    oauthExcludedRequestToken += 1;
    excludedCache.clearInFlight(scopeKey, OAUTH_EXCLUDED_QUERY_KEY);
    set((state) => {
      if (state.scopeKey !== scopeKey) {
        return state;
      }
      return {
        excludedLoading: false,
        excludedError: null,
        scopeKey
      };
    });
  },

  invalidateModelAlias: (scopeKey = getCurrentSessionScopeKey()) => {
    oauthModelAliasRequestToken += 1;
    modelAliasCache.clearInFlight(scopeKey, OAUTH_MODEL_ALIAS_QUERY_KEY);
    set((state) => {
      if (state.scopeKey !== scopeKey) {
        return state;
      }
      return {
        modelAliasLoading: false,
        modelAliasError: null,
        scopeKey
      };
    });
  },

  clearOauthState: () => {
    oauthExcludedRequestToken += 1;
    oauthModelAliasRequestToken += 1;
    excludedCache.clear();
    modelAliasCache.clear();
    set({
      ...createEmptyOauthState(),
      excludedLoading: false,
      modelAliasLoading: false
    });
  }
}));
