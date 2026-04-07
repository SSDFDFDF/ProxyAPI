import {
  useCallback,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { animate } from 'motion/mini';
import type { AnimationPlaybackControlsWithThen } from 'motion-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Button } from '@/components/ui/Button';
import { FilterTabs, type FilterTabItem } from '@/components/ui/FilterTabs';
import { PageFilterSection } from '@/components/ui/PageFilterSection';
import { PageTitleBlock } from '@/components/ui/PageTitleBlock';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFilterAll,
  IconInfo,
  IconModelCluster,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { authFilesApi } from '@/services/api';
import { copyToClipboard } from '@/utils/clipboard';
import { formatFileSize } from '@/utils/format';
import { calculateStatusBarData, normalizeAuthIndex } from '@/utils/usage';
import {
  MAX_CARD_PAGE_SIZE,
  MIN_CARD_PAGE_SIZE,
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  formatModified,
  getAuthFileIcon,
  getAuthFileStatusMessage,
  getTypeColor,
  getTypeLabel,
  hasAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
  resolveQuotaErrorMessage,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import {
  BatchAuthFileFieldsModal,
  type BatchAuthFileFieldsState,
  type BatchEditableFieldKey,
} from '@/features/authFiles/components/BatchAuthFileFieldsModal';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { refreshQuotaForFiles } from '@/components/quota';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStats } from '@/features/authFiles/hooks/useAuthFilesStats';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  isAuthFilesSortMode,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesSortMode,
} from '@/features/authFiles/uiState';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { formatQuotaResetTime, isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import { applyAuthFileEditableValues } from '@/features/authFiles/authFileEditor';
import type {
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
} from '@/types';
import styles from './AuthFilesPage.module.scss';

const easePower3Out = (progress: number) => 1 - (1 - progress) ** 4;
const easePower2In = (progress: number) => progress ** 3;
const BATCH_BAR_BASE_TRANSFORM = 'translateX(-50%)';
const BATCH_BAR_HIDDEN_TRANSFORM = 'translateX(-50%) translateY(56px)';
const DEFAULT_PAGE_SIZE = 9;
const INITIAL_BATCH_FIELD_STATE: BatchAuthFileFieldsState = {
  prefix: { enabled: false, value: '' },
  proxyUrl: { enabled: false, value: '' },
  priority: { enabled: false, value: '' },
  excludedModelsText: { enabled: false, value: '' },
  disableCooling: { enabled: false, value: '' },
  websockets: { enabled: false, value: false },
  note: { enabled: false, value: '' },
};

type QuotaSummaryItem = {
  tone: 'normal' | 'muted' | 'danger';
  label: string;
  value?: string;
  subtext?: string;
  percent?: number | null;
  actionable?: boolean;
};

type SearchableQuotaState = {
  searchText?: string;
  error?: string;
  errorStatus?: number;
};

const escapeWildcardSearchSegment = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

const getAuthFileSearchValues = (item: AuthFileItem): string[] => {
  const rawErrorMessage =
    item.errorMessage ?? item['error_message'] ?? item.error ?? item['error'] ?? '';
  const errorMessage =
    typeof rawErrorMessage === 'string' ? rawErrorMessage : String(rawErrorMessage);

  return [
    item.name,
    item.type,
    item.provider,
    item.status,
    getAuthFileStatusMessage(item),
    errorMessage,
    typeof item.note === 'string' ? item.note : '',
  ]
    .map((value) => (value == null ? '' : String(value)))
    .filter((value) => value.length > 0);
};

const getQuotaSearchTextValues = (quota: SearchableQuotaState | undefined): string[] =>
  [
    quota?.searchText,
    quota?.error,
    quota?.errorStatus == null ? '' : String(quota.errorStatus),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const navigate = useNavigate();
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const geminiCliQuota = useQuotaStore((state) => state.geminiCliQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);

  const [filter, setFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'disabled' | 'warning' | 'virtual'
  >('all');
  const [problemOnly, setProblemOnly] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageSizeInput, setPageSizeInput] = useState(String(DEFAULT_PAGE_SIZE));
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const [batchQuotaRefreshing, setBatchQuotaRefreshing] = useState(false);
  const [quotaRefreshingNames, setQuotaRefreshingNames] = useState<Record<string, boolean>>({});
  const [batchFieldsModalOpen, setBatchFieldsModalOpen] = useState(false);
  const [batchFieldsSaving, setBatchFieldsSaving] = useState(false);
  const [batchFields, setBatchFields] =
    useState<BatchAuthFileFieldsState>(INITIAL_BATCH_FIELD_STATE);
  const [includeDisabledQuota, setIncludeDisabledQuota] = useState(false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const batchActionAnimationRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  const previousSelectionCountRef = useRef(0);
  const selectionCountRef = useRef(0);

  const { keyStats, usageDetails, loadKeyStats, refreshKeyStats } = useAuthFilesStats();
  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData({ refreshKeyStats });

  const statusBarCache = useAuthFilesStatusBarCache(files, usageDetails);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  } = useAuthFilesModels();

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles,
    loadKeyStats: refreshKeyStats,
  });

  const disableControls = connectionStatus !== 'connected';
  const normalizedFilter = normalizeProviderKey(String(filter));
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(persisted.filter);
      }
      if (
        typeof persisted.statusFilter === 'string' &&
        ['all', 'active', 'disabled', 'warning', 'virtual'].includes(persisted.statusFilter)
      ) {
        setStatusFilter(persisted.statusFilter as typeof statusFilter);
      }
      if (typeof persisted.problemOnly === 'boolean') {
        setProblemOnly(persisted.problemOnly);
      }
      if (typeof persistedCompactMode !== 'boolean' && typeof persisted.compactMode === 'boolean') {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      const legacyPageSize =
        typeof persisted.pageSize === 'number' && Number.isFinite(persisted.pageSize)
          ? clampCardPageSize(persisted.pageSize)
          : null;
      if (legacyPageSize !== null) {
        setPageSize(legacyPageSize);
      }
      if (isAuthFilesSortMode(persisted.sortMode)) {
        setSortMode(persisted.sortMode);
      }
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      statusFilter,
      problemOnly,
      compactMode,
      search,
      page,
      pageSize,
      sortMode,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    filter,
    statusFilter,
    page,
    pageSize,
    problemOnly,
    search,
    sortMode,
    uiStateHydrated,
  ]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const commitPageSizeInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const next = clampCardPageSize(value);
    setPageSize(next);
    setPageSizeInput(String(next));
    setPage(1);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setPageSizeInput(rawValue);

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const rounded = Math.round(parsed);
    if (rounded < MIN_CARD_PAGE_SIZE || rounded > MAX_CARD_PAGE_SIZE) return;

    setPageSize(rounded);
    setPage(1);
  };

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setPage(1);
      void loadFiles().catch(() => {});
    },
    [loadFiles, sortMode]
  );

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles(), refreshKeyStats(), loadExcluded(), loadModelAlias()]);
  }, [loadFiles, refreshKeyStats, loadExcluded, loadModelAlias]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    void loadKeyStats().catch(() => {});
    loadExcluded();
    loadModelAlias();
  }, [loadFiles, loadKeyStats, loadExcluded, loadModelAlias]);

  useInterval(() => {
    void refreshKeyStats().catch(() => {});
  }, 240_000);

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      if (file.type) {
        types.add(file.type);
      }
    });
    return Array.from(types);
  }, [files]);

  const filesMatchingProblemFilter = useMemo(
    () => (problemOnly ? files.filter(hasAuthFileStatusMessage) : files),
    [files, problemOnly]
  );

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'priority', label: t('auth_files.sort_priority') },
    ],
    [t]
  );

  const statusFilterOptions = useMemo(
    () => [
      { value: 'all', label: t('auth_files.status_filter_all') },
      { value: 'active', label: t('auth_files.status_filter_active') },
      { value: 'disabled', label: t('auth_files.status_filter_disabled') },
      { value: 'warning', label: t('auth_files.status_filter_warning') },
      { value: 'virtual', label: t('auth_files.status_filter_virtual') },
    ],
    [t]
  );

  const getQuotaSearchValues = useCallback(
    (item: AuthFileItem): string[] => {
      const provider = resolveAuthProvider(item);

      if (provider === 'antigravity') {
        return getQuotaSearchTextValues(antigravityQuota[item.name]);
      }
      if (provider === 'claude') {
        return getQuotaSearchTextValues(claudeQuota[item.name]);
      }
      if (provider === 'codex') {
        return getQuotaSearchTextValues(codexQuota[item.name]);
      }
      if (provider === 'gemini-cli') {
        return getQuotaSearchTextValues(geminiCliQuota[item.name]);
      }
      if (provider === 'kimi') {
        return getQuotaSearchTextValues(kimiQuota[item.name]);
      }

      return [];
    },
    [antigravityQuota, claudeQuota, codexQuota, geminiCliQuota, kimiQuota]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingProblemFilter.length };
    filesMatchingProblemFilter.forEach((file) => {
      if (!file.type) return;
      counts[file.type] = (counts[file.type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingProblemFilter]);

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  const filtered = useMemo(() => {
    const normalizedTerm = normalizedSearch.toLowerCase();

    return filesMatchingProblemFilter.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;

      let matchStatus = true;
      if (statusFilter !== 'all') {
        const isRuntime = isRuntimeOnlyAuthFile(item);
        const isDisabled = Boolean(item.disabled);
        const hasWarning = hasAuthFileStatusMessage(item) && !isDisabled && !isRuntime;
        if (statusFilter === 'active') {
          matchStatus = !isDisabled && !isRuntime && !hasWarning;
        } else if (statusFilter === 'disabled') {
          matchStatus = isDisabled;
        } else if (statusFilter === 'warning') {
          matchStatus = hasWarning;
        } else if (statusFilter === 'virtual') {
          matchStatus = isRuntime;
        }
      }

      const matchSearch =
        !normalizedSearch ||
        [...getAuthFileSearchValues(item), ...getQuotaSearchValues(item)].some((content) =>
          wildcardSearch
            ? wildcardSearch.test(content)
            : content.toLowerCase().includes(normalizedTerm)
        );
      return matchType && matchStatus && matchSearch;
    });
  }, [
    filesMatchingProblemFilter,
    filter,
    getQuotaSearchValues,
    normalizedSearch,
    statusFilter,
    wildcardSearch,
  ]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortMode === 'default') {
      copy.sort((a, b) => {
        const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
        const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
        const providerCompare = providerA.localeCompare(providerB);
        if (providerCompare !== 0) return providerCompare;
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'az') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'priority') {
      copy.sort((a, b) => {
        const pa = parsePriorityValue(a.priority ?? a['priority']) ?? 0;
        const pb = parsePriorityValue(b.priority ?? b['priority']) ?? 0;
        return pb - pa; // 高优先级排前面
      });
    }
    return copy;
  }, [filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const fileMap = useMemo(() => new Map(files.map((file) => [file.name, file])), [files]);
  const selectedQuotaTargets = useMemo(
    () => {
      const existingFiles = selectedNames
        .map((name) => fileMap.get(name))
        .filter((file): file is AuthFileItem => Boolean(file));

      return existingFiles.filter(
        (file) => !isRuntimeOnlyAuthFile(file) && (includeDisabledQuota || !isDisabledAuthFile(file))
      );
    },
    [fileMap, includeDisabledQuota, selectedNames]
  );
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;
  const batchQuotaButtonDisabled =
    disableControls || batchQuotaRefreshing || selectedQuotaTargets.length === 0;
  const batchEditFieldsButtonDisabled =
    disableControls || batchFieldsSaving || selectedNames.length === 0;

  const resetBatchFieldsState = useCallback(() => {
    setBatchFields(INITIAL_BATCH_FIELD_STATE);
  }, []);

  const handleBatchFieldToggle = useCallback((field: BatchEditableFieldKey, enabled: boolean) => {
    setBatchFields((prev) => ({
      ...prev,
      [field]: { ...prev[field], enabled },
    }));
  }, []);

  const handleBatchFieldChange = useCallback(
    (field: BatchEditableFieldKey, value: string | boolean) => {
      setBatchFields((prev) => ({
        ...prev,
        [field]: { ...prev[field], value } as BatchAuthFileFieldsState[BatchEditableFieldKey],
      }));
    },
    []
  );

  const handleCloseBatchFieldsModal = useCallback(() => {
    if (batchFieldsSaving) return;
    setBatchFieldsModalOpen(false);
    resetBatchFieldsState();
  }, [batchFieldsSaving, resetBatchFieldsState]);

  const handleBatchFieldsSave = useCallback(async () => {
    const enabledEntries = Object.entries(batchFields).filter(([, state]) => state.enabled);
    if (enabledEntries.length === 0) {
      showNotification(
        t('auth_files.batch_edit_fields_empty', {
          defaultValue: '请至少选择一个要批量更新的字段',
        }),
        'error'
      );
      return;
    }

    const priorityState = batchFields.priority;
    const batchNeedsJsonSave =
      batchFields.excludedModelsText.enabled ||
      batchFields.disableCooling.enabled ||
      batchFields.websockets.enabled;

    if (priorityState.enabled) {
      const trimmed = priorityState.value.trim();
      if (trimmed && !Number.isFinite(Number.parseInt(trimmed, 10))) {
        showNotification(
          t('auth_files.batch_edit_fields_priority_invalid', {
            defaultValue: '优先级必须是整数',
          }),
          'error'
        );
        return;
      }
    }

    setBatchFieldsSaving(true);
    try {
      const results = await Promise.allSettled(
        selectedNames.map(async (name) => {
          const file = fileMap.get(name);
          if (!file) {
            throw new Error(t('common.unknown_error'));
          }

          if (!batchNeedsJsonSave) {
            const trimmed = batchFields.priority.value.trim();
            const priorityValue = !batchFields.priority.enabled
              ? undefined
              : !trimmed
                ? 0
                : Number.parseInt(trimmed, 10);

            return authFilesApi.patchFields({
              name,
              ...(batchFields.prefix.enabled ? { prefix: batchFields.prefix.value } : {}),
              ...(batchFields.proxyUrl.enabled ? { proxy_url: batchFields.proxyUrl.value } : {}),
              ...(batchFields.note.enabled ? { note: batchFields.note.value } : {}),
              ...(batchFields.priority.enabled ? { priority: priorityValue ?? 0 } : {}),
            });
          }

          const json = await authFilesApi.downloadJsonObject(name);
          const normalizedType = String(file.type ?? '')
            .trim()
            .toLowerCase();
          const normalizedProvider = String(file.provider ?? '')
            .trim()
            .toLowerCase();
          const isCodexFile = normalizedType === 'codex' || normalizedProvider === 'codex';
          const nextJson = applyAuthFileEditableValues(
            json,
            {
              prefix: batchFields.prefix.value,
              proxyUrl: batchFields.proxyUrl.value,
              priority: batchFields.priority.value,
              excludedModelsText: batchFields.excludedModelsText.value,
              disableCooling: batchFields.disableCooling.value,
              websockets: batchFields.websockets.value,
              note: batchFields.note.value,
              noteTouched: batchFields.note.enabled,
            },
            {
              isCodexFile,
              enabled: {
                prefix: batchFields.prefix.enabled,
                proxyUrl: batchFields.proxyUrl.enabled,
                priority: batchFields.priority.enabled,
                excludedModelsText: batchFields.excludedModelsText.enabled,
                disableCooling: batchFields.disableCooling.enabled,
                websockets: batchFields.websockets.enabled,
                note: batchFields.note.enabled,
              },
            }
          );
          return authFilesApi.saveJsonObject(name, nextJson);
        })
      );

      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      await loadFiles();
      await refreshKeyStats();

      if (failedCount === 0) {
        showNotification(
          t('auth_files.batch_edit_fields_success', {
            count: successCount,
            defaultValue: '已更新 {{count}} 个认证文件',
          }),
          'success'
        );
      } else {
        showNotification(
          t('auth_files.batch_edit_fields_summary', {
            success: successCount,
            failed: failedCount,
            defaultValue: '批量更新完成：成功 {{success}} 个，失败 {{failed}} 个',
          }),
          failedCount > 0 ? 'error' : 'success'
        );
      }

      setBatchFieldsModalOpen(false);
      resetBatchFieldsState();
    } finally {
      setBatchFieldsSaving(false);
    }
  }, [
    batchFields,
    fileMap,
    loadFiles,
    refreshKeyStats,
    resetBatchFieldsState,
    selectedNames,
    showNotification,
    t,
  ]);

  const handleBatchQuotaRefresh = useCallback(async () => {
    if (batchQuotaButtonDisabled) return;
    setBatchQuotaRefreshing(true);
    try {
      const results = await refreshQuotaForFiles(selectedQuotaTargets, t);
      const successCount = results.filter((result) => result.status === 'success').length;
      const failedCount = results.filter((result) => result.status === 'error').length;
      const skippedCount = results.filter((result) => result.status === 'skipped').length;

      if (successCount > 0 && failedCount === 0 && skippedCount === 0) {
        showNotification(
          t('auth_files.batch_quota_refresh_success', {
            count: successCount,
            defaultValue: '已刷新 {{count}} 个文件的额度',
          }),
          'success'
        );
        return;
      }

      showNotification(
        t('auth_files.batch_quota_refresh_summary', {
          success: successCount,
          failed: failedCount,
          skipped: skippedCount,
          defaultValue:
            '额度刷新完成：成功 {{success}} 个，失败 {{failed}} 个，跳过 {{skipped}} 个',
        }),
        failedCount > 0 ? 'error' : 'info'
      );
    } finally {
      setBatchQuotaRefreshing(false);
    }
  }, [batchQuotaButtonDisabled, selectedQuotaTargets, showNotification, t]);

  const handleSingleQuotaRefresh = useCallback(
    async (file: (typeof pageItems)[number]) => {
      if (
        disableControls ||
        isRuntimeOnlyAuthFile(file) ||
        (!includeDisabledQuota && isDisabledAuthFile(file))
      ) {
        return;
      }
      if (quotaRefreshingNames[file.name]) return;

      setQuotaRefreshingNames((prev) => ({ ...prev, [file.name]: true }));
      try {
        const [result] = await refreshQuotaForFiles([file], t);
        if (!result || result.status === 'skipped') return;
        if (result.status === 'success') {
          showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
          return;
        }
        showNotification(
          t('auth_files.quota_refresh_failed', {
            name: file.name,
            message: result.error || t('common.unknown_error'),
          }),
          'error'
        );
      } finally {
        setQuotaRefreshingNames((prev) => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
      }
    },
    [disableControls, includeDisabledQuota, quotaRefreshingNames, showNotification, t]
  );

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) {
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
      return;
    }

    const updatePadding = () => {
      const height = actionsEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--auth-files-action-bar-height', `${height}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    ro?.observe(actionsEl);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updatePadding);
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
    };
  }, [batchActionBarVisible, selectionCount]);

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setBatchActionBarVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!batchActionBarVisible) return;
    const currentCount = selectionCount;
    const previousCount = previousSelectionCountRef.current;
    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) return;

    batchActionAnimationRef.current?.stop();
    batchActionAnimationRef.current = null;

    if (currentCount > 0 && previousCount === 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_HIDDEN_TRANSFORM, BATCH_BAR_BASE_TRANSFORM],
          opacity: [0, 1],
        },
        {
          duration: 0.28,
          ease: easePower3Out,
          onComplete: () => {
            actionsEl.style.transform = BATCH_BAR_BASE_TRANSFORM;
            actionsEl.style.opacity = '1';
          },
        }
      );
    } else if (currentCount === 0 && previousCount > 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_BASE_TRANSFORM, BATCH_BAR_HIDDEN_TRANSFORM],
          opacity: [1, 0],
        },
        {
          duration: 0.22,
          ease: easePower2In,
          onComplete: () => {
            if (selectionCountRef.current === 0) {
              setBatchActionBarVisible(false);
            }
          },
        }
      );
    }

    previousSelectionCountRef.current = currentCount;
  }, [batchActionBarVisible, selectionCount]);

  useEffect(
    () => () => {
      batchActionAnimationRef.current?.stop();
      batchActionAnimationRef.current = null;
    },
    []
  );

  const filterTabItems = useMemo<FilterTabItem[]>(
    () =>
      existingTypes.map((type) => {
        const iconSrc = getAuthFileIcon(type, resolvedTheme);
        const color =
          type === 'all'
            ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
            : getTypeColor(type, resolvedTheme);
        const buttonStyle = {
          '--filter-color': color.text,
          '--filter-surface': color.bg,
          '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
        } as CSSProperties;

        return {
          id: type,
          label: getTypeLabel(t, type),
          active: filter === type,
          count: typeCounts[type] ?? 0,
          style: buttonStyle,
          icon:
            type === 'all' ? (
              <IconFilterAll className={styles.filterAllIcon} size={16} />
            ) : iconSrc ? (
              <img src={iconSrc} alt="" className={styles.filterTagIcon} />
            ) : (
              <span className={styles.filterTagIconFallback}>
                {getTypeLabel(t, type).slice(0, 1).toUpperCase()}
              </span>
            ),
          onClick: () => {
            setFilter(type);
            setPage(1);
          },
        };
      }),
    [existingTypes, filter, resolvedTheme, t, typeCounts]
  );

  const deleteAllButtonLabel = problemOnly
    ? filter === 'all'
      ? t('auth_files.delete_problem_button')
      : t('auth_files.delete_problem_button_with_type', { type: getTypeLabel(t, filter) })
    : filter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, filter)}`;

  const resolveQuotaSummary = useCallback(
    (file: (typeof pageItems)[number]): QuotaSummaryItem[] | null => {
      if (isRuntimeOnlyAuthFile(file)) return null;
      if (!includeDisabledQuota && isDisabledAuthFile(file)) return null;

      const provider = resolveAuthProvider(file);
      const summaryFromStatus = (
        i18nPrefix: string,
        quota:
          | AntigravityQuotaState
          | ClaudeQuotaState
          | CodexQuotaState
          | GeminiCliQuotaState
          | KimiQuotaState
          | undefined
      ): QuotaSummaryItem[] | null => {
        if (!quota || quota.status === 'idle') {
          return [{ tone: 'muted', label: t(`${i18nPrefix}.idle`), actionable: true }];
        }
        if (quota.status === 'loading') {
          return [{ tone: 'muted', label: t(`${i18nPrefix}.loading`) }];
        }
        if (quota.status === 'error') {
          return [
            {
              tone: 'danger',
              label: resolveQuotaErrorMessage(
                t,
                quota.errorStatus,
                quota.error || t('common.unknown_error')
              ),
            },
          ];
        }
        return null;
      };

      if (provider === 'antigravity') {
        const quota = antigravityQuota[file.name];
        const fallback = summaryFromStatus('antigravity_quota', quota);
        if (fallback) return fallback;
        const groups = quota?.groups ?? [];
        if (groups.length === 0) return null;
        return groups.map((group) => ({
          tone: 'normal' as const,
          label: group.label,
          value: `${Math.round(Math.max(0, group.remainingFraction) * 100)}%`,
          subtext: formatQuotaResetTime(group.resetTime),
          percent: Math.round(Math.max(0, group.remainingFraction) * 100),
        }));
      }

      if (provider === 'claude') {
        const quota = claudeQuota[file.name];
        const fallback = summaryFromStatus('claude_quota', quota);
        if (fallback) return fallback;
        const windows = quota?.windows ?? [];
        if (windows.length === 0) return null;
        return windows.map((window) => {
          const remainingPercent =
            window.usedPercent === null ? null : Math.max(0, 100 - Math.round(window.usedPercent));
          return {
            tone: 'normal' as const,
            label: window.label,
            value: remainingPercent === null ? '-' : `${remainingPercent}%`,
            subtext: window.resetLabel,
            percent: remainingPercent,
          };
        });
      }

      if (provider === 'codex') {
        const quota = codexQuota[file.name];
        const fallback = summaryFromStatus('codex_quota', quota);
        if (fallback) return fallback;
        const windows = quota?.windows ?? [];
        if (windows.length === 0) return null;
        return windows.map((window) => {
          const remainingPercent =
            window.usedPercent === null ? null : Math.max(0, 100 - Math.round(window.usedPercent));
          return {
            tone: 'normal' as const,
            label: window.label,
            value: remainingPercent === null ? '-' : `${remainingPercent}%`,
            subtext: window.resetLabel,
            percent: remainingPercent,
          };
        });
      }

      if (provider === 'gemini-cli') {
        const quota = geminiCliQuota[file.name];
        const fallback = summaryFromStatus('gemini_cli_quota', quota);
        if (fallback) return fallback;
        const buckets = quota?.buckets ?? [];
        if (buckets.length === 0) return null;
        return buckets.map((bucket) => ({
          tone: 'normal' as const,
          label: bucket.label,
          value:
            bucket.remainingFraction === null
              ? bucket.remainingAmount === null
                ? '-'
                : String(bucket.remainingAmount)
              : `${Math.round(bucket.remainingFraction * 100)}%`,
          subtext:
            quota?.creditBalance != null
              ? `Credits ${quota.creditBalance}`
              : formatQuotaResetTime(bucket.resetTime),
          percent:
            bucket.remainingFraction === null ? null : Math.round(bucket.remainingFraction * 100),
        }));
      }

      if (provider === 'kimi') {
        const quota = kimiQuota[file.name];
        const fallback = summaryFromStatus('kimi_quota', quota);
        if (fallback) return fallback;
        const rows = quota?.rows ?? [];
        if (rows.length === 0) return null;
        return rows.map((row) => {
          const remainingPercent =
            row.limit > 0 ? Math.max(0, Math.round(((row.limit - row.used) / row.limit) * 100)) : 0;
          return {
            tone: 'normal' as const,
            label: row.label ?? t('nav.quota_management'),
            value: `${remainingPercent}%`,
            subtext: row.resetHint || '-',
            percent: remainingPercent,
          };
        });
      }

      return null;
    },
    [antigravityQuota, claudeQuota, codexQuota, geminiCliQuota, includeDisabledQuota, kimiQuota, t]
  );

  const renderCompactList = () => (
    <div className={styles.compactTableWrap}>
      <table className={styles.compactTable}>
        <thead>
          <tr>
            <th className={styles.compactTableSelectCol}>
              <SelectionCheckbox
                checked={
                  selectablePageItems.length > 0 &&
                  selectablePageItems.every((file) => selectedFiles.has(file.name))
                }
                onChange={() => {
                  const allSelected =
                    selectablePageItems.length > 0 &&
                    selectablePageItems.every((file) => selectedFiles.has(file.name));
                  if (allSelected) {
                    invertVisibleSelection(pageItems);
                  } else {
                    selectAllVisible(pageItems);
                  }
                }}
                aria-label={t('auth_files.batch_select_page')}
                title={t('auth_files.batch_select_page')}
                disabled={selectablePageItems.length === 0}
              />
            </th>
            <th className={styles.compactTableFileCol}>{t('auth_files.title_section')}</th>
            <th className={styles.compactTableQuotaCol}>{t('nav.quota_management')}</th>
            <th className={styles.compactTableHealthCol}>{t('auth_files.health_status_label')}</th>
            <th className={styles.compactTableActionsCol}>
              {t('common.actions', { defaultValue: '操作' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((file) => {
            const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
            const selected = selectedFiles.has(file.name);
            const statusMessage = getAuthFileStatusMessage(file);
            const hasStatusWarning = Boolean(statusMessage) && !file.disabled && !isRuntimeOnly;
            const typeLabel = getTypeLabel(t, file.type || 'unknown');
            const typeColor = getTypeColor(file.type || 'unknown', resolvedTheme);
            const providerIcon = getAuthFileIcon(file.type || 'unknown', resolvedTheme);
            const priorityValue = parsePriorityValue(file.priority ?? file['priority']);
            const showModelsButton =
              !isRuntimeOnly || (file.type || '').toLowerCase() === 'aistudio';
            const quotaSummary = resolveQuotaSummary(file);
            const stateLabel = isRuntimeOnly
              ? t('auth_files.type_virtual')
              : file.disabled
                ? t('auth_files.health_status_disabled')
                : hasStatusWarning
                  ? t('auth_files.health_status_warning')
                  : t('auth_files.status_toggle_label');
            const stateBadgeClass = isRuntimeOnly
              ? styles.stateBadgeVirtual
              : file.disabled
                ? styles.stateBadgeDisabled
                : hasStatusWarning
                  ? styles.stateBadgeWarning
                  : styles.stateBadgeActive;
            const authIndexKey =
              normalizeAuthIndex(file['auth_index'] ?? file.authIndex ?? null) ?? '';
            const statusData = statusBarCache.get(authIndexKey) ?? calculateStatusBarData([]);

            return (
              <tr key={file.name} className={selected ? styles.compactTableRowSelected : ''}>
                <td className={styles.compactTableSelectCol}>
                  {!isRuntimeOnly ? (
                    <SelectionCheckbox
                      checked={selected}
                      onChange={() => toggleSelect(file.name)}
                      aria-label={
                        selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                      }
                      title={
                        selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                      }
                    />
                  ) : (
                    <span className={styles.compactListPlaceholder}>-</span>
                  )}
                </td>

                <td>
                  <div className={styles.compactListMain}>
                    <div className={styles.compactListIdentity}>
                      <div
                        className={styles.compactListTypeBadge}
                        style={{
                          backgroundColor: typeColor.bg,
                          color: typeColor.text,
                          ...(typeColor.border ? { border: typeColor.border } : {}),
                        }}
                      >
                        {providerIcon ? (
                          <img src={providerIcon} alt="" className={styles.compactListTypeIcon} />
                        ) : null}
                        <span>{typeLabel}</span>
                      </div>
                      <div className={styles.compactListNameWrap}>
                        <div className={styles.compactListName} title={file.name}>
                          {file.name}
                        </div>
                        {typeof file.note === 'string' && file.note.trim() ? (
                          <div className={styles.compactListNote} title={file.note.trim()}>
                            {file.note.trim()}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className={styles.compactListMeta}>
                      <span>
                        {t('auth_files.file_size')}: {file.size ? formatFileSize(file.size) : '-'}
                      </span>
                      <span>
                        {t('auth_files.file_modified')}: {formatModified(file)}
                      </span>
                      {priorityValue !== undefined ? (
                        <span>
                          {t('auth_files.priority_display')}: {priorityValue}
                        </span>
                      ) : null}
                      <span className={`${styles.stateBadge} ${stateBadgeClass}`}>
                        {stateLabel}
                      </span>
                    </div>

                    {statusMessage ? (
                      <div
                        className={`${styles.compactListStatusMessage} ${
                          hasStatusWarning ? styles.compactListStatusWarning : ''
                        }`}
                        title={statusMessage}
                      >
                        <IconInfo size={12} />
                        <span>{statusMessage}</span>
                      </div>
                    ) : null}
                  </div>
                </td>

                <td>
                  <div className={styles.compactListQuotaColumn}>
                    {quotaSummary?.length ? (
                      quotaSummary.map((item) => (
                        <div
                          key={`${file.name}-${item.label}-${item.subtext ?? ''}`}
                          className={`${styles.compactListQuotaCard} ${
                            item.tone === 'danger'
                              ? styles.compactListQuotaCardDanger
                              : item.tone === 'muted'
                                ? styles.compactListQuotaCardMuted
                                : ''
                          }`}
                        >
                          {item.actionable ? (
                            <button
                              type="button"
                              className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
                              onClick={() => void handleSingleQuotaRefresh(file)}
                              disabled={disableControls || quotaRefreshingNames[file.name]}
                            >
                              {item.label}
                            </button>
                          ) : (
                            <>
                              <div className={styles.compactListQuotaHeader}>
                                <span className={styles.compactListQuotaLabel}>{item.label}</span>
                                {item.value ? (
                                  <span className={styles.compactListQuotaValue}>{item.value}</span>
                                ) : null}
                              </div>
                              <div className={styles.compactListQuotaBar}>
                                <div
                                  className={styles.compactListQuotaBarFill}
                                  style={{
                                    width: `${Math.max(0, Math.min(100, item.percent ?? 0))}%`,
                                  }}
                                />
                              </div>
                              {item.subtext ? (
                                <div className={styles.compactListQuotaSubtext}>{item.subtext}</div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ))
                    ) : (
                      <div
                        className={`${styles.compactListQuotaCard} ${styles.compactListQuotaCardMuted}`}
                      >
                        <div className={styles.compactListQuotaHeader}>
                          <span className={styles.compactListQuotaLabel}>-</span>
                        </div>
                      </div>
                    )}
                  </div>
                </td>

                <td>
                  <div className={styles.compactListStats}>
                    <ProviderStatusBar statusData={statusData} styles={styles} />
                    <div className={styles.compactListStatsCounts}>
                      <span className={styles.compactListStatsSuccess}>
                        {statusData.totalSuccess}
                      </span>
                      <span className={styles.compactListStatsDivider}>/</span>
                      <span className={styles.compactListStatsFailure}>
                        {statusData.totalFailure}
                      </span>
                    </div>
                  </div>
                </td>

                <td>
                  <div className={styles.compactListActions}>
                    {showModelsButton ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => showModels(file)}
                        title={t('auth_files.models_button', { defaultValue: '模型' })}
                      >
                        <IconModelCluster size={14} />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openPrefixProxyEditor(file)}
                      title={t('auth_files.prefix_proxy_manage', { defaultValue: '前缀代理' })}
                    >
                      <IconSettings size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(file.name)}
                      title={t('common.download')}
                    >
                      <IconDownload size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(file.name)}
                      disabled={disableControls || deleting === file.name}
                      title={t('common.delete')}
                    >
                      <IconTrash2 size={14} />
                    </Button>
                    {!isRuntimeOnly ? (
                      <div className={styles.compactListToggle}>
                        <ToggleSwitch
                          checked={!file.disabled}
                          onChange={(value) => handleStatusToggle(file, value)}
                          disabled={disableControls || statusUpdating[file.name]}
                          ariaLabel={t('auth_files.status_toggle_label')}
                        />
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <PageTitleBlock
          title={t('auth_files.title')}
          description={t('auth_files.description')}
          count={files.length}
          className={styles.pageHeaderCopy}
        />

        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIncludeDisabledQuota((prev) => !prev)}
            className={`${styles.includeDisabledButton} ${
              includeDisabledQuota ? styles.includeDisabledButtonActive : ''
            }`}
            aria-pressed={includeDisabledQuota}
            title={t('quota_management.include_disabled')}
          >
            <>
              {includeDisabledQuota ? <IconEye size={16} /> : <IconEyeOff size={16} />}
              {t('quota_management.include_disabled')}
            </>
          </Button>
          <Button variant="secondary" size="sm" onClick={handleHeaderRefresh} disabled={loading}>
            {t('common.refresh')}
          </Button>
          <Button
            size="sm"
            onClick={handleUploadClick}
            disabled={disableControls || uploading}
            loading={uploading}
          >
            {t('auth_files.upload_button')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              handleDeleteAll({
                filter,
                problemOnly,
                onResetFilterToAll: () => setFilter('all'),
                onResetProblemOnly: () => setProblemOnly(false),
              })
            }
            disabled={disableControls || loading || deletingAll}
            loading={deletingAll}
          >
            {deleteAllButtonLabel}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      <section className={styles.mainSection}>
        {error && <div className={styles.errorBox}>{error}</div>}

        <PageFilterSection className={styles.filterSection}>
          <FilterTabs items={filterTabItems} />

          <div className={styles.filterContent}>
            <div className={styles.filterControlsPanel}>
              <div className={styles.filterControls}>
                <div className={`${styles.filterItem} ${styles.filterSearchItem}`}>
                  <span className={styles.filterItemLabel}>{t('auth_files.search_label')}</span>
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('auth_files.search_placeholder')}
                    aria-label={t('auth_files.search_label')}
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.filterCompactItem}`}>
                  <span className={styles.filterItemLabel}>{t('auth_files.page_size_label')}</span>
                  <input
                    className={styles.pageSizeSelect}
                    type="number"
                    min={MIN_CARD_PAGE_SIZE}
                    max={MAX_CARD_PAGE_SIZE}
                    step={1}
                    value={pageSizeInput}
                    onChange={handlePageSizeChange}
                    onBlur={(e) => commitPageSizeInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.filterCompactItem}`}>
                  <span className={styles.filterItemLabel}>
                    {t('auth_files.status_filter_label')}
                  </span>
                  <Select
                    className={styles.sortSelect}
                    value={statusFilter}
                    options={statusFilterOptions}
                    onChange={(value) => {
                      setStatusFilter(value as typeof statusFilter);
                      setPage(1);
                    }}
                    ariaLabel={t('auth_files.status_filter_label')}
                    fullWidth
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.filterCompactItem}`}>
                  <span className={styles.filterItemLabel}>{t('auth_files.sort_label')}</span>
                  <Select
                    className={styles.sortSelect}
                    value={sortMode}
                    options={sortOptions}
                    onChange={handleSortModeChange}
                    ariaLabel={t('auth_files.sort_label')}
                    fullWidth
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
                  <span className={styles.filterItemLabel}>
                    {t('auth_files.display_options_label')}
                  </span>
                  <div className={styles.filterToggleGroup}>
                    <div className={styles.filterToggleChip}>
                      <ToggleSwitch
                        checked={problemOnly}
                        onChange={(value) => {
                          setProblemOnly(value);
                          setPage(1);
                        }}
                        ariaLabel={t('auth_files.problem_filter_only')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.problem_filter_only')}
                          </span>
                        }
                      />
                    </div>
                    <div className={styles.filterToggleChip}>
                      <ToggleSwitch
                        checked={compactMode}
                        onChange={(value) => setCompactMode(value)}
                        ariaLabel={t('auth_files.compact_mode_label')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.compact_mode_label')}
                          </span>
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {loading ? (
              <div className={styles.hint}>{t('common.loading')}</div>
            ) : pageItems.length === 0 ? (
              <EmptyState
                title={t('auth_files.search_empty_title')}
                description={t('auth_files.search_empty_desc')}
              />
            ) : compactMode ? (
              renderCompactList()
            ) : (
              <div
                className={`${styles.fileGrid} ${quotaFilterType ? styles.fileGridQuotaManaged : ''}`}
              >
                {pageItems.map((file) => (
                  <AuthFileCard
                    key={file.name}
                    file={file}
                    compact={false}
                    selected={selectedFiles.has(file.name)}
                    resolvedTheme={resolvedTheme}
                    disableControls={disableControls}
                    includeDisabledQuota={includeDisabledQuota}
                    deleting={deleting}
                    statusUpdating={statusUpdating}
                    quotaFilterType={quotaFilterType}
                    keyStats={keyStats}
                    statusBarCache={statusBarCache}
                    onShowModels={showModels}
                    onDownload={handleDownload}
                    onOpenPrefixProxyEditor={openPrefixProxyEditor}
                    onDelete={handleDelete}
                    onToggleStatus={handleStatusToggle}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            )}

            {!loading && (compactMode || sorted.length > pageSize) && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: currentPage,
                    total: totalPages,
                    count: sorted.length,
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </div>
        </PageFilterSection>
      </section>

      <div className={styles.oauthCardsGrid}>
        <OAuthExcludedCard
          disableControls={disableControls}
          excludedError={excludedError}
          excluded={excluded}
          onAdd={() => openExcludedEditor()}
          onEdit={openExcludedEditor}
          onDelete={deleteExcluded}
        />

        <OAuthModelAliasCard
          disableControls={disableControls}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onAdd={() => openModelAliasEditor()}
          onEditProvider={openModelAliasEditor}
          onDeleteProvider={deleteModelAlias}
          modelAliasError={modelAliasError}
          modelAlias={modelAlias}
          allProviderModels={allProviderModels}
          onUpdate={handleMappingUpdate}
          onDeleteLink={handleDeleteLink}
          onToggleFork={handleToggleFork}
          onRenameAlias={handleRenameAlias}
          onDeleteAlias={handleDeleteAlias}
        />
      </div>

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      <BatchAuthFileFieldsModal
        open={batchFieldsModalOpen}
        selectedCount={selectedNames.length}
        saving={batchFieldsSaving}
        disableControls={disableControls}
        fields={batchFields}
        onClose={handleCloseBatchFieldsModal}
        onSave={() => void handleBatchFieldsSave()}
        onFieldToggle={handleBatchFieldToggle}
        onFieldChange={handleBatchFieldChange}
      />

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_page')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(sorted)}
                    disabled={selectableFilteredItems.length === 0}
                  >
                    {t('auth_files.batch_select_filtered')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => invertVisibleSelection(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_invert_page')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setBatchFieldsModalOpen(true)}
                    disabled={batchEditFieldsButtonDisabled}
                  >
                    {t('auth_files.batch_edit_fields', { defaultValue: '批量编辑' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleBatchQuotaRefresh()}
                    disabled={batchQuotaButtonDisabled}
                    loading={batchQuotaRefreshing}
                  >
                    {t('auth_files.batch_quota_refresh', { defaultValue: '获取额度' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void batchDownload(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('auth_files.batch_download')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
