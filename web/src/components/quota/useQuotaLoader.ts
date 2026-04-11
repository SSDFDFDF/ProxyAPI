/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem, QuotaRefreshSource } from '@/types';
import { useQuotaStore } from '@/stores';
import {
  QUOTA_AUTO_REFRESH_INTERVAL_MS,
  QUOTA_AUTO_REFRESH_MAX_BACKOFF_MS,
  QUOTA_REFRESH_CONCURRENCY,
} from '@/utils/constants';
import { mapWithConcurrencyLimit } from '@/utils/async';
import { getSearchTextFromError, getStatusFromError } from '@/utils/quota';
import { useSessionScopeKey } from '@/stores/serverState/sessionScope';
import type { QuotaConfig, QuotaFetchResult } from './quotaConfigs';
import type { QuotaStatusState } from './QuotaCard';

type QuotaScope = 'page' | 'all';
type QuotaLoadSource = Exclude<QuotaRefreshSource, 'single'>;

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (payload: { scopeKey: string; updater: QuotaUpdater<T> }) => void;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: QuotaFetchResult<TData>;
  error?: string;
  errorStatus?: number;
  searchText?: string;
}

interface LoadQuotaOptions {
  targets: AuthFileItem[];
  scope: QuotaScope;
  source: QuotaLoadSource;
  silent?: boolean;
  setLoading: (
    loading: boolean,
    scope?: QuotaScope | null,
    source?: QuotaLoadSource | null
  ) => void;
}

const resolvePollBackoffMs = (consecutiveFailures: number) =>
  Math.min(
    QUOTA_AUTO_REFRESH_INTERVAL_MS * 2 ** Math.max(0, consecutiveFailures - 1),
    QUOTA_AUTO_REFRESH_MAX_BACKOFF_MS
  );

const resolveNextRefreshAt = (
  source: QuotaLoadSource,
  completedAt: number,
  consecutiveFailures: number
) =>
  completedAt +
  (source === 'poll' && consecutiveFailures > 0
    ? resolvePollBackoffMs(consecutiveFailures)
    : QUOTA_AUTO_REFRESH_INTERVAL_MS);

export function useQuotaLoader<TState extends QuotaStatusState, TData>(
  config: QuotaConfig<TState, TData>
) {
  const { t } = useTranslation();
  const scopeKey = useSessionScopeKey();
  const emptyQuotaRef = useRef<Record<string, TState>>({} as Record<string, TState>);
  const ensureScope = useQuotaStore((state) => state.ensureScope);
  const quota = useQuotaStore((state) =>
    state.scopeKey === scopeKey
      ? config.storeSelector(state)
      : emptyQuotaRef.current
  );
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const activeSourceRef = useRef<QuotaLoadSource | null>(null);
  const queuedRequestRef = useRef<LoadQuotaOptions | null>(null);

  useEffect(() => {
    ensureScope(scopeKey);
  }, [ensureScope, scopeKey]);

  const loadQuota = useCallback(
    async function runLoadQuota({
      targets,
      scope,
      source,
      silent = source === 'poll',
      setLoading,
    }: LoadQuotaOptions) {
      if (loadingRef.current) {
        if (activeSourceRef.current === 'poll' && source !== 'poll') {
          queuedRequestRef.current = { targets, scope, source, silent, setLoading };
        }
        return;
      }
      loadingRef.current = true;
      activeSourceRef.current = source;
      const requestId = ++requestIdRef.current;
      const requestScopeKey = currentScopeKeyRef.current;
      const attemptAt = Date.now();
      setLoading(true, scope, source);

      try {
        if (targets.length === 0) return;

        setQuota({
          scopeKey: requestScopeKey,
          updater: (prev) => {
            const nextState = { ...prev };
            targets.forEach((file) => {
              const previousState = prev[file.name];
              if (
                silent &&
                previousState &&
                (previousState.status === 'success' || previousState.status === 'error')
              ) {
                nextState[file.name] = {
                  ...previousState,
                  isRefreshing: true,
                  lastAttemptAt: attemptAt,
                  refreshSource: source,
                };
                return;
              }

              nextState[file.name] = {
                ...config.buildLoadingState(),
                isRefreshing: true,
                lastAttemptAt: attemptAt,
                lastUpdatedAt: previousState?.lastUpdatedAt,
                refreshSource: source,
                consecutiveFailures: previousState?.consecutiveFailures ?? 0,
                nextRetryAt: null,
                lastRefreshError: undefined,
                lastRefreshErrorStatus: undefined,
              };
            });
            return nextState;
          }
        });

        const results = await mapWithConcurrencyLimit(
          targets,
          QUOTA_REFRESH_CONCURRENCY,
          async (file): Promise<LoadQuotaResult<TData>> => {
            try {
              const data = await config.fetchQuota(file, t);
              return { name: file.name, status: 'success', data };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return {
                name: file.name,
                status: 'error',
                error: message,
                errorStatus,
                searchText: getSearchTextFromError(err) ?? message,
              };
            }
          }
        );

        if (requestId !== requestIdRef.current) return;

        setQuota({
          scopeKey: requestScopeKey,
          updater: (prev) => {
            const completedAt = Date.now();
            const nextState = { ...prev };
            results.forEach((result) => {
              const previousState = prev[result.name];
              if (result.status === 'success') {
                nextState[result.name] = config.buildSuccessState(
                  result.data as QuotaFetchResult<TData>
                );
                nextState[result.name] = {
                  ...nextState[result.name],
                  isRefreshing: false,
                  lastAttemptAt: attemptAt,
                  lastUpdatedAt: completedAt,
                  refreshSource: source,
                  consecutiveFailures: 0,
                  nextRetryAt: resolveNextRefreshAt(source, completedAt, 0),
                  lastRefreshError: undefined,
                  lastRefreshErrorStatus: undefined,
                };
              } else {
                const nextFailureCount =
                  source === 'poll'
                    ? Math.max(1, (previousState?.consecutiveFailures ?? 0) + 1)
                    : 0;
                const nextRetryAt = resolveNextRefreshAt(
                  source,
                  completedAt,
                  nextFailureCount
                );

                if (source === 'poll' && previousState?.status === 'success') {
                  nextState[result.name] = {
                    ...previousState,
                    isRefreshing: false,
                    lastAttemptAt: attemptAt,
                    refreshSource: source,
                    consecutiveFailures: nextFailureCount,
                    nextRetryAt,
                    lastRefreshError: result.error || t('common.unknown_error'),
                    lastRefreshErrorStatus: result.errorStatus,
                  };
                  return;
                }

                nextState[result.name] = config.buildErrorState(
                  result.error || t('common.unknown_error'),
                  result.errorStatus,
                  result.searchText
                );
                nextState[result.name] = {
                  ...nextState[result.name],
                  isRefreshing: false,
                  lastAttemptAt: attemptAt,
                  lastUpdatedAt: previousState?.lastUpdatedAt,
                  refreshSource: source,
                  consecutiveFailures: nextFailureCount,
                  nextRetryAt,
                  lastRefreshError:
                    source === 'poll' ? result.error || t('common.unknown_error') : undefined,
                  lastRefreshErrorStatus: source === 'poll' ? result.errorStatus : undefined,
                };
              }
            });
            return nextState;
          }
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
          activeSourceRef.current = null;

          if (queuedRequestRef.current) {
            const queuedRequest = queuedRequestRef.current;
            queuedRequestRef.current = null;
            queueMicrotask(() => {
              void runLoadQuota(queuedRequest);
            });
          }
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
