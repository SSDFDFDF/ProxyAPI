import { create } from 'zustand';
import { authFilesApi } from '@/services/api';
import { CACHE_EXPIRY_MS, STORAGE_KEY_SERVER_STATE_AUTH_FILES } from '@/utils/constants';
import type { AuthFileItem } from '@/types';
import { ScopedQueryCache } from './serverState/scopedQueryCache';
import { getCurrentSessionScopeKey } from './serverState/sessionScope';

export type LoadAuthFilesOptions = {
  force?: boolean;
  staleTimeMs?: number;
};

type AuthFilesSnapshot = {
  files: AuthFileItem[];
  lastRefreshedAt: number;
};

type AuthFilesUpdater = AuthFileItem[] | ((prev: AuthFileItem[]) => AuthFileItem[]);

type AuthFilesState = {
  files: AuthFileItem[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  scopeKey: string;
  loadAuthFiles: (options?: LoadAuthFilesOptions) => Promise<AuthFileItem[]>;
  setAuthFiles: (files: AuthFileItem[], fetchedAt?: number, scopeKey?: string) => void;
  updateAuthFiles: (updater: AuthFilesUpdater, scopeKey?: string) => void;
  invalidateAuthFiles: (scopeKey?: string) => void;
  clearAuthFiles: () => void;
};

const AUTH_FILES_QUERY_KEY = 'list';
const authFilesCache = new ScopedQueryCache<AuthFilesSnapshot>(STORAGE_KEY_SERVER_STATE_AUTH_FILES);

let authFilesRequestToken = 0;

const createEmptyAuthFilesState = (scopeKey: string = '') => ({
  files: [],
  lastRefreshedAt: null,
  scopeKey
});

const hydrateAuthFilesScopeState = (
  scopeKey: string
): Pick<AuthFilesState, 'files' | 'lastRefreshedAt'> => {
  const cached = authFilesCache.getEntry(scopeKey, AUTH_FILES_QUERY_KEY);
  if (!cached) {
    return createEmptyAuthFilesState(scopeKey);
  }

  return {
    files: cached.data.files,
    lastRefreshedAt: cached.data.lastRefreshedAt
  };
};

const resolveUpdater = (updater: AuthFilesUpdater, prev: AuthFileItem[]) =>
  typeof updater === 'function' ? (updater as (value: AuthFileItem[]) => AuthFileItem[])(prev) : updater;

const getActiveAuthFilesBase = (
  state: AuthFilesState,
  scopeKey: string
): Pick<AuthFilesState, 'files' | 'lastRefreshedAt'> => {
  if (state.scopeKey === scopeKey) {
    return {
      files: state.files,
      lastRefreshedAt: state.lastRefreshedAt
    };
  }

  return hydrateAuthFilesScopeState(scopeKey);
};

export const useAuthFilesStore = create<AuthFilesState>((set, get) => ({
  ...createEmptyAuthFilesState(),
  loading: false,
  error: null,

  loadAuthFiles: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? CACHE_EXPIRY_MS;
    const scopeKey = getCurrentSessionScopeKey();
    const state = get();
    const scopeChanged = state.scopeKey !== scopeKey;

    if (scopeChanged) {
      set({
        ...hydrateAuthFilesScopeState(scopeKey),
        loading: false,
        error: null,
        scopeKey
      });
    }

    const inFlightRequest = authFilesCache.getInFlight(scopeKey, AUTH_FILES_QUERY_KEY);
    if (inFlightRequest) {
      const requestId = authFilesRequestToken;
      const snapshot = await inFlightRequest;
      if (requestId !== authFilesRequestToken || getCurrentSessionScopeKey() !== scopeKey) {
        return snapshot.files;
      }
      set({
        files: snapshot.files,
        loading: false,
        error: null,
        lastRefreshedAt: snapshot.lastRefreshedAt,
        scopeKey
      });
      return snapshot.files;
    }

    if (!force) {
      const cached = authFilesCache.getFreshEntry(scopeKey, AUTH_FILES_QUERY_KEY, staleTimeMs)?.data;
      if (cached) {
        set({
          files: cached.files,
          loading: false,
          error: null,
          lastRefreshedAt: cached.lastRefreshedAt,
          scopeKey
        });
        return cached.files;
      }
    }

    const requestId = (authFilesRequestToken += 1);
    set({ loading: true, error: null, scopeKey });

    const requestPromise = (async (): Promise<AuthFilesSnapshot> => {
      const result = await authFilesApi.list();
      return {
        files: result?.files ?? [],
        lastRefreshedAt: Date.now()
      };
    })();

    authFilesCache.setInFlight(scopeKey, AUTH_FILES_QUERY_KEY, requestPromise);

    try {
      const snapshot = await requestPromise;
      if (requestId !== authFilesRequestToken) {
        return snapshot.files;
      }

      authFilesCache.setEntry(scopeKey, AUTH_FILES_QUERY_KEY, snapshot, snapshot.lastRefreshedAt);
      set({
        files: snapshot.files,
        loading: false,
        error: null,
        lastRefreshedAt: snapshot.lastRefreshedAt,
        scopeKey
      });
      return snapshot.files;
    } catch (error: unknown) {
      if (requestId !== authFilesRequestToken) {
        throw error;
      }
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to load auth files';
      set({
        loading: false,
        error: message,
        scopeKey
      });
      throw error;
    } finally {
      authFilesCache.clearInFlight(scopeKey, AUTH_FILES_QUERY_KEY, requestPromise);
    }
  },

  setAuthFiles: (files, fetchedAt = Date.now(), scopeKey = getCurrentSessionScopeKey()) => {
    const snapshot: AuthFilesSnapshot = { files, lastRefreshedAt: fetchedAt };
    authFilesCache.setEntry(scopeKey, AUTH_FILES_QUERY_KEY, snapshot, fetchedAt);
    set((state) => {
      if (state.scopeKey !== scopeKey) {
        return state;
      }
      return {
        files,
        loading: false,
        error: null,
        lastRefreshedAt: fetchedAt,
        scopeKey
      };
    });
  },

  updateAuthFiles: (updater, scopeKey = getCurrentSessionScopeKey()) => {
    authFilesRequestToken += 1;
    authFilesCache.clearInFlight(scopeKey, AUTH_FILES_QUERY_KEY);
    set((state) => {
      const base = getActiveAuthFilesBase(state, scopeKey);
      const nextFiles = resolveUpdater(updater, base.files);
      const nextRefreshedAt = Date.now();
      authFilesCache.setEntry(
        scopeKey,
        AUTH_FILES_QUERY_KEY,
        { files: nextFiles, lastRefreshedAt: nextRefreshedAt },
        nextRefreshedAt
      );

      if (state.scopeKey !== scopeKey) {
        return state;
      }

      return {
        files: nextFiles,
        lastRefreshedAt: nextRefreshedAt,
        scopeKey,
        error: null,
        loading: false
      };
    });
  },

  invalidateAuthFiles: (scopeKey = getCurrentSessionScopeKey()) => {
    authFilesRequestToken += 1;
    authFilesCache.clearInFlight(scopeKey, AUTH_FILES_QUERY_KEY);
    set((state) => {
      if (state.scopeKey !== scopeKey) {
        return state;
      }
      return {
        loading: false,
        error: null,
        scopeKey
      };
    });
  },

  clearAuthFiles: () => {
    authFilesRequestToken += 1;
    authFilesCache.clear();
    set({
      ...createEmptyAuthFilesState(),
      loading: false,
      error: null
    });
  }
}));
