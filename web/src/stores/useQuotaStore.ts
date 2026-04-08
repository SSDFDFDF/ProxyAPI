/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
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

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  ...buildEmptyQuotaState(),
  ensureScope: (scopeKey) =>
    set((state) => {
      if (state.scopeKey === scopeKey) {
        return state;
      }

      return buildEmptyQuotaState(scopeKey);
    }),
  setAntigravityQuota: (payload) =>
    set((state) => applyScopedQuotaUpdate(state, payload, 'antigravityQuota')),
  setClaudeQuota: (payload) =>
    set((state) => applyScopedQuotaUpdate(state, payload, 'claudeQuota')),
  setCodexQuota: (payload) =>
    set((state) => applyScopedQuotaUpdate(state, payload, 'codexQuota')),
  setGeminiCliQuota: (payload) =>
    set((state) => applyScopedQuotaUpdate(state, payload, 'geminiCliQuota')),
  setKimiQuota: (payload) =>
    set((state) => applyScopedQuotaUpdate(state, payload, 'kimiQuota')),
  clearQuotaCache: () =>
    set((state) => buildEmptyQuotaState(state.scopeKey))
}));
