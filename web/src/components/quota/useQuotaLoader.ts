/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { QUOTA_REFRESH_CONCURRENCY } from '@/utils/constants';
import { mapWithConcurrencyLimit } from '@/utils/async';
import { getSearchTextFromError, getStatusFromError } from '@/utils/quota';
import { useSessionScopeKey } from '@/stores/serverState/sessionScope';
import type { QuotaConfig, QuotaFetchResult } from './quotaConfigs';

type QuotaScope = 'page' | 'all';

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

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
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

  useEffect(() => {
    ensureScope(scopeKey);
  }, [ensureScope, scopeKey]);

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      const requestScopeKey = currentScopeKeyRef.current;
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        setQuota({
          scopeKey: requestScopeKey,
          updater: (prev) => {
            const nextState = { ...prev };
            targets.forEach((file) => {
              nextState[file.name] = config.buildLoadingState();
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
            const nextState = { ...prev };
            results.forEach((result) => {
              if (result.status === 'success') {
                nextState[result.name] = config.buildSuccessState(
                  result.data as QuotaFetchResult<TData>
                );
              } else {
                nextState[result.name] = config.buildErrorState(
                  result.error || t('common.unknown_error'),
                  result.errorStatus,
                  result.searchText
                );
              }
            });
            return nextState;
          }
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
