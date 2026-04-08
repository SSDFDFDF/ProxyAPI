/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import { SERVER_STATE_PERSIST_MAX_SCOPES, STORAGE_KEY_QUOTA_CACHE } from '@/utils/constants';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import type { AntigravityQuotaState, ClaudeQuotaState, CodexQuotaState, GeminiCliQuotaState, KimiQuotaState } from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);
type ScopedQuotaUpdater<T> = {
  scopeKey: string;
  updater: QuotaUpdater<T>;
};

interface QuotaStoreState {
  scopeKey: string;
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  ensureScope: (scopeKey: string) => void;
  setAntigravityQuota: (payload: ScopedQuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (payload: ScopedQuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (payload: ScopedQuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (payload: ScopedQuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setKimiQuota: (payload: ScopedQuotaUpdater<Record<string, KimiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

const resolveUpdater = <T,>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

const applyScopedQuotaUpdate = <T,>(
  state: QuotaStoreState,
  payload: ScopedQuotaUpdater<T>,
  key: keyof Pick<
    QuotaStoreState,
    'antigravityQuota' | 'claudeQuota' | 'codexQuota' | 'geminiCliQuota' | 'kimiQuota'
  >
) => {
  if (state.scopeKey !== payload.scopeKey) {
    return state;
  }

  return {
    [key]: resolveUpdater(payload.updater, state[key] as T)
  };
};

const buildEmptyQuotaState = (scopeKey: string = '') => ({
  scopeKey,
  antigravityQuota: {},
  claudeQuota: {},
  codexQuota: {},
  geminiCliQuota: {},
  kimiQuota: {}
});

const canUsePersistentStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

type PersistedQuotaState = {
  version: 1;
  scopes: Array<ReturnType<typeof buildEmptyQuotaState>>;
};

const normalizeQuotaState = (stored: unknown): ReturnType<typeof buildEmptyQuotaState> => {
  if (!stored || typeof stored !== 'object') {
    return buildEmptyQuotaState();
  }

  const value = stored as Partial<ReturnType<typeof buildEmptyQuotaState>>;
  return {
    scopeKey: typeof value.scopeKey === 'string' ? value.scopeKey : '',
    antigravityQuota:
      value.antigravityQuota && typeof value.antigravityQuota === 'object' ? value.antigravityQuota : {},
    claudeQuota: value.claudeQuota && typeof value.claudeQuota === 'object' ? value.claudeQuota : {},
    codexQuota: value.codexQuota && typeof value.codexQuota === 'object' ? value.codexQuota : {},
    geminiCliQuota:
      value.geminiCliQuota && typeof value.geminiCliQuota === 'object' ? value.geminiCliQuota : {},
    kimiQuota: value.kimiQuota && typeof value.kimiQuota === 'object' ? value.kimiQuota : {}
  };
};

const readPersistedQuotaState = (): ReturnType<typeof buildEmptyQuotaState> => {
  if (!canUsePersistentStorage()) {
    return buildEmptyQuotaState();
  }

  const stored = obfuscatedStorage.getItem<PersistedQuotaState | ReturnType<typeof buildEmptyQuotaState>>(
    STORAGE_KEY_QUOTA_CACHE,
    {
      obfuscate: true,
    }
  );

  if (!stored || typeof stored !== 'object') {
    return buildEmptyQuotaState();
  }

  if ('version' in stored && stored.version === 1 && Array.isArray(stored.scopes)) {
    const [firstScope] = stored.scopes;
    return normalizeQuotaState(firstScope);
  }

  return normalizeQuotaState(stored);
};

const persistQuotaState = (state: ReturnType<typeof buildEmptyQuotaState>) => {
  if (!canUsePersistentStorage()) return;

  const existing = obfuscatedStorage.getItem<PersistedQuotaState>(STORAGE_KEY_QUOTA_CACHE, {
    obfuscate: true,
  });
  const nextScopes = [
    state,
    ...((existing?.scopes ?? []).filter((entry) => entry.scopeKey !== state.scopeKey).map(normalizeQuotaState)),
  ].slice(0, SERVER_STATE_PERSIST_MAX_SCOPES);

  const payload: PersistedQuotaState = {
    version: 1,
    scopes: nextScopes,
  };

  obfuscatedStorage.setItem(STORAGE_KEY_QUOTA_CACHE, payload, { obfuscate: true });
};

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  ...readPersistedQuotaState(),
  ensureScope: (scopeKey) =>
    set((state) => {
      if (state.scopeKey === scopeKey) {
        return state;
      }

      const nextState = buildEmptyQuotaState(scopeKey);
      persistQuotaState(nextState);
      return nextState;
    }),
  setAntigravityQuota: (payload) =>
    set((state) => {
      const nextPartial = applyScopedQuotaUpdate(state, payload, 'antigravityQuota');
      const nextState = nextPartial === state ? state : { ...state, ...nextPartial };
      if (nextState !== state) {
        persistQuotaState(nextState);
      }
      return nextPartial;
    }),
  setClaudeQuota: (payload) =>
    set((state) => {
      const nextPartial = applyScopedQuotaUpdate(state, payload, 'claudeQuota');
      const nextState = nextPartial === state ? state : { ...state, ...nextPartial };
      if (nextState !== state) {
        persistQuotaState(nextState);
      }
      return nextPartial;
    }),
  setCodexQuota: (payload) =>
    set((state) => {
      const nextPartial = applyScopedQuotaUpdate(state, payload, 'codexQuota');
      const nextState = nextPartial === state ? state : { ...state, ...nextPartial };
      if (nextState !== state) {
        persistQuotaState(nextState);
      }
      return nextPartial;
    }),
  setGeminiCliQuota: (payload) =>
    set((state) => {
      const nextPartial = applyScopedQuotaUpdate(state, payload, 'geminiCliQuota');
      const nextState = nextPartial === state ? state : { ...state, ...nextPartial };
      if (nextState !== state) {
        persistQuotaState(nextState);
      }
      return nextPartial;
    }),
  setKimiQuota: (payload) =>
    set((state) => {
      const nextPartial = applyScopedQuotaUpdate(state, payload, 'kimiQuota');
      const nextState = nextPartial === state ? state : { ...state, ...nextPartial };
      if (nextState !== state) {
        persistQuotaState(nextState);
      }
      return nextPartial;
    }),
  clearQuotaCache: () =>
    set((state) => {
      const nextState = buildEmptyQuotaState(state.scopeKey);
      persistQuotaState(nextState);
      return nextState;
    })
}));
