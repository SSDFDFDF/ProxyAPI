/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TitleWithCount } from '@/components/ui/PageTitleBlock';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { QUOTA_AUTO_REFRESH_INTERVAL_MS } from '@/utils/constants';
import { getSearchTextFromError, getStatusFromError, isDisabledAuthFile } from '@/utils/quota';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import { useSessionScopeKey } from '@/stores/serverState/sessionScope';
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { readQuotaAutoRefreshEnabled, writeQuotaAutoRefreshEnabled } from './autoRefreshPreference';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (payload: { scopeKey: string; updater: QuotaUpdater<T> }) => void;

type ViewMode = 'paged' | 'all';
type QuotaLoadSource = 'manual' | 'poll';

const DEFAULT_ITEMS_PER_PAGE = 15;
const MAX_ITEMS_PER_PAGE = 100;
const MAX_SHOW_ALL_THRESHOLD = 100;
const PAGE_SIZE_OPTIONS = [15, 25, 50, MAX_ITEMS_PER_PAGE].map((value) => ({
  value: String(value),
  label: String(value),
}));

const areNameListsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((name, index) => name === right[index]);

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  loadingSource: QuotaLoadSource | null;
  setLoading: (
    loading: boolean,
    scope?: 'page' | 'all' | null,
    source?: QuotaLoadSource | null
  ) => void;
}

const useQuotaPagination = <T,>(
  items: T[],
  defaultPageSize = DEFAULT_ITEMS_PER_PAGE
): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);
  const [loadingSource, setLoadingSource] = useState<QuotaLoadSource | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback(
    (
      isLoading: boolean,
      scope?: 'page' | 'all' | null,
      source?: QuotaLoadSource | null
    ) => {
      setLoadingState(isLoading);
      setLoadingScope(isLoading ? (scope ?? null) : null);
      setLoadingSource(isLoading ? (source ?? null) : null);
    },
    []
  );

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    loadingSource,
    setLoading
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
  includeDisabled?: boolean;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled,
  includeDisabled = false
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const scopeKey = useSessionScopeKey();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const [, gridRef] = useGridColumns(300); // Keep JS-side width heuristic aligned with the grid CSS
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() =>
    readQuotaAutoRefreshEnabled(scopeKey)
  );
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const [visibleCardNames, setVisibleCardNames] = useState<string[]>([]);
  const cardNodesRef = useRef(new Map<string, HTMLDivElement>());

  const filteredFiles = useMemo(
    () =>
      files.filter(
        (file) => config.matchesFile(file) && (includeDisabled || !isDisabledAuthFile(file))
      ),
    [files, config, includeDisabled]
  );
  const showAllAllowed = filteredFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    loadingSource,
    setLoading
  } = useQuotaPagination(filteredFiles);
  const visibleItems = effectiveViewMode === 'all' ? filteredFiles : pageItems;

  useEffect(() => {
    if (showAllAllowed) return;
    if (viewMode !== 'all') return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setViewMode('paged');
      setShowTooManyWarning(true);
    });

    return () => {
      cancelled = true;
    };
  }, [showAllAllowed, viewMode]);

  const { quota, loadQuota } = useQuotaLoader(config);

  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);

  const setCardNode = useCallback((name: string, node: HTMLDivElement | null) => {
    if (node) {
      cardNodesRef.current.set(name, node);
      return;
    }
    cardNodesRef.current.delete(name);
  }, []);

  useEffect(() => {
    setAutoRefreshEnabled(readQuotaAutoRefreshEnabled(scopeKey));
  }, [scopeKey]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleAutoRefreshChange = useCallback(
    (enabled: boolean) => {
      setAutoRefreshEnabled(enabled);
      writeQuotaAutoRefreshEnabled(scopeKey, enabled);
    },
    [scopeKey]
  );

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    const targets = effectiveViewMode === 'all' ? filteredFiles : pageItems;
    if (targets.length === 0) return;
    void loadQuota({
      targets,
      scope,
      source: 'manual',
      setLoading
    });
  }, [loading, effectiveViewMode, filteredFiles, pageItems, loadQuota, setLoading]);

  useEffect(() => {
    if (loading) return;
    if (filteredFiles.length === 0) {
      setQuota({
        scopeKey,
        updater: (prev) => (Object.keys(prev).length === 0 ? prev : {})
      });
      return;
    }
    setQuota({
      scopeKey,
      updater: (prev) => {
        const nextState: Record<string, TState> = {};
        let changed = false;

        filteredFiles.forEach((file) => {
          const cached = prev[file.name];
          if (cached) {
            nextState[file.name] = cached;
          }
        });

        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(nextState);
        if (prevKeys.length !== nextKeys.length) {
          changed = true;
        } else {
          changed = prevKeys.some((key) => prev[key] !== nextState[key]);
        }

        return changed ? nextState : prev;
      }
    });
  }, [filteredFiles, loading, scopeKey, setQuota]);

  useEffect(() => {
    if (effectiveViewMode !== 'all') {
      setVisibleCardNames([]);
      return undefined;
    }

    const renderedNames = visibleItems.map((item) => item.name);
    if (typeof IntersectionObserver === 'undefined') {
      setVisibleCardNames((prev) =>
        areNameListsEqual(prev, renderedNames) ? prev : renderedNames
      );
      return undefined;
    }

    setVisibleCardNames((prev) => prev.filter((name) => renderedNames.includes(name)));

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleCardNames((prev) => {
          const next = new Set(prev);
          let changed = false;

          entries.forEach((entry) => {
            const name = entry.target.getAttribute('data-quota-item-name');
            if (!name) return;

            if (entry.isIntersecting) {
              if (!next.has(name)) {
                next.add(name);
                changed = true;
              }
              return;
            }

            if (next.delete(name)) {
              changed = true;
            }
          });

          return changed ? renderedNames.filter((name) => next.has(name)) : prev;
        });
      },
      { threshold: 0.15 }
    );

    renderedNames.forEach((name) => {
      const node = cardNodesRef.current.get(name);
      if (node) {
        observer.observe(node);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [effectiveViewMode, visibleItems]);

  const pollItems = useMemo(() => {
    if (effectiveViewMode !== 'all') return visibleItems;
    if (visibleCardNames.length === 0) return [];

    const visibleNameSet = new Set(visibleCardNames);
    return visibleItems.filter((item) => visibleNameSet.has(item.name));
  }, [effectiveViewMode, visibleCardNames, visibleItems]);

  useEffect(() => {
    if (!autoRefreshEnabled) return undefined;
    if (disabled || loading || sectionLoading || !isDocumentVisible) return undefined;
    if (pollItems.length === 0) return undefined;

    const now = Date.now();
    let nextPollDelayMs: number | null = null;

    pollItems.forEach((item) => {
      const state = quota[item.name];
      if (!state || !state.nextRetryAt) {
        nextPollDelayMs = 0;
        return;
      }
      if (state.isRefreshing) return;

      const delayMs = Math.max(0, state.nextRetryAt - now);
      nextPollDelayMs = nextPollDelayMs === null ? delayMs : Math.min(nextPollDelayMs, delayMs);
    });

    if (nextPollDelayMs === null) return undefined;

    const timeoutId = window.setTimeout(() => {
      const targets = pollItems.filter((item) => {
        const state = quota[item.name];
        if (!state) return true;
        if (state.isRefreshing) return false;
        if (!state.nextRetryAt) return true;
        return state.nextRetryAt <= Date.now();
      });

      if (targets.length === 0) return;

      void loadQuota({
        targets,
        scope: effectiveViewMode === 'all' ? 'all' : 'page',
        source: 'poll',
        setLoading
      });
    }, nextPollDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    autoRefreshEnabled,
    disabled,
    effectiveViewMode,
    isDocumentVisible,
    loadQuota,
    loading,
    pollItems,
    quota,
    sectionLoading,
    setLoading
  ]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled) return;
      if (!includeDisabled && isDisabledAuthFile(file)) return;
      if (quota[file.name]?.status === 'loading' || quota[file.name]?.isRefreshing) return;

      const attemptAt = Date.now();

      setQuota({
        scopeKey,
        updater: (prev) => {
          const previousState = prev[file.name];
          return {
            ...prev,
            [file.name]: {
              ...config.buildLoadingState(),
              isRefreshing: true,
              lastAttemptAt: attemptAt,
              lastUpdatedAt: previousState?.lastUpdatedAt,
              refreshSource: 'single',
              consecutiveFailures: previousState?.consecutiveFailures ?? 0,
              nextRetryAt: null,
              lastRefreshError: undefined,
              lastRefreshErrorStatus: undefined,
            }
          };
        }
      });

      try {
        const data = await config.fetchQuota(file, t);
        const completedAt = Date.now();
        setQuota({
          scopeKey,
          updater: (prev) => ({
            ...prev,
            [file.name]: {
              ...config.buildSuccessState(data),
              isRefreshing: false,
              lastAttemptAt: attemptAt,
              lastUpdatedAt: completedAt,
              refreshSource: 'single',
              consecutiveFailures: 0,
              nextRetryAt: completedAt + QUOTA_AUTO_REFRESH_INTERVAL_MS,
              lastRefreshError: undefined,
              lastRefreshErrorStatus: undefined,
            }
          })
        });
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        const searchText = getSearchTextFromError(err) ?? message;
        setQuota({
          scopeKey,
          updater: (prev) => {
            const previousState = prev[file.name];
            return {
              ...prev,
              [file.name]: {
                ...config.buildErrorState(message, status, searchText),
                isRefreshing: false,
                lastAttemptAt: attemptAt,
                lastUpdatedAt: previousState?.lastUpdatedAt,
                refreshSource: 'single',
                consecutiveFailures: 0,
                nextRetryAt: Date.now() + QUOTA_AUTO_REFRESH_INTERVAL_MS,
                lastRefreshError: undefined,
                lastRefreshErrorStatus: undefined,
              }
            };
          }
        });
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [config, disabled, includeDisabled, quota, scopeKey, setQuota, showNotification, t]
  );

  const titleNode = (
    <TitleWithCount title={t(`${config.i18nPrefix}.title`)} count={filteredFiles.length} />
  );

  const isManuallyRefreshing = loading || (sectionLoading && loadingSource !== 'poll');
  const isManualRefreshDisabled = disabled || loading || (sectionLoading && loadingSource !== 'poll');

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => {
                if (filteredFiles.length > MAX_SHOW_ALL_THRESHOLD) {
                  setShowTooManyWarning(true);
                } else {
                  setViewMode('all');
                }
              }}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          {effectiveViewMode === 'paged' && (
            <div className={styles.pageSizeControl}>
              <span className={styles.pageSizeLabel}>{t('auth_files.page_size_label')}</span>
              <Select
                className={styles.pageSizeSelect}
                value={String(pageSize)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(value) => setPageSize(Number.parseInt(value, 10) || DEFAULT_ITEMS_PER_PAGE)}
                ariaLabel={t('auth_files.page_size_label')}
                fullWidth={false}
              />
            </div>
          )}
          <div className={styles.autoRefreshControl}>
            <ToggleSwitch
              checked={autoRefreshEnabled}
              onChange={handleAutoRefreshChange}
              ariaLabel={t('quota_management.auto_refresh')}
              label={t('quota_management.auto_refresh')}
            />
            <span className={styles.autoRefreshHint}>
              {t('quota_management.auto_refresh_interval', {
                seconds: Math.round(QUOTA_AUTO_REFRESH_INTERVAL_MS / 1000)
              })}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={isManualRefreshDisabled}
            loading={isManuallyRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isManuallyRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
        </div>
      }
    >
      {filteredFiles.length === 0 ? (
        <EmptyState
          title={t(`${config.i18nPrefix}.empty_title`)}
          description={t(`${config.i18nPrefix}.empty_desc`)}
        />
      ) : (
        <>
          <div ref={gridRef} className={config.gridClassName}>
            {visibleItems.map((item) => (
              <div
                key={item.name}
                ref={(node) => setCardNode(item.name, node)}
                data-quota-item-name={item.name}
              >
                <QuotaCard
                  item={item}
                  quota={quota[item.name]}
                  resolvedTheme={resolvedTheme}
                  i18nPrefix={config.i18nPrefix}
                  cardIdleMessageKey={config.cardIdleMessageKey}
                  cardClassName={config.cardClassName}
                  defaultType={config.type}
                  canRefresh={!disabled && (includeDisabled || !isDisabledAuthFile(item))}
                  onRefresh={() => void refreshQuotaForFile(item)}
                  renderQuotaItems={config.renderQuotaItems}
                />
              </div>
            ))}
          </div>
          {filteredFiles.length > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToPrev}
                disabled={currentPage <= 1}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: filteredFiles.length
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
      {showTooManyWarning && (
        <div className={styles.warningOverlay} onClick={() => setShowTooManyWarning(false)}>
          <div className={styles.warningModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('auth_files.too_many_files_warning')}</p>
            <Button variant="primary" size="sm" onClick={() => setShowTooManyWarning(false)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
