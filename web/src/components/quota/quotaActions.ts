import type { TFunction } from 'i18next';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getCurrentSessionScopeKey } from '@/stores/serverState/sessionScope';
import { QUOTA_REFRESH_CONCURRENCY } from '@/utils/constants';
import { mapWithConcurrencyLimit } from '@/utils/async';
import { getSearchTextFromError, getStatusFromError } from '@/utils/quota';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  type QuotaConfig,
} from './quotaConfigs';

type QuotaUpdater<T> = T | ((prev: T) => T);
type QuotaSetter<TState> = (payload: {
  scopeKey: string;
  updater: QuotaUpdater<Record<string, TState>>;
}) => void;

export type QuotaRefreshResult = {
  name: string;
  status: 'success' | 'error' | 'skipped';
  configType?: string;
  error?: string;
  errorStatus?: number;
};

export const QUOTA_CONFIGS = [
  CLAUDE_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
] as const;

type QuotaType = (typeof QUOTA_CONFIGS)[number]['type'];
type QuotaConfigByType = (typeof QUOTA_CONFIGS)[number];

const QUOTA_CONFIG_BY_TYPE = {
  claude: CLAUDE_CONFIG,
  antigravity: ANTIGRAVITY_CONFIG,
  codex: CODEX_CONFIG,
  'gemini-cli': GEMINI_CLI_CONFIG,
  kimi: KIMI_CONFIG,
} as const;

export const getQuotaConfigByType = (type: string): QuotaConfigByType | null => {
  if (!(type in QUOTA_CONFIG_BY_TYPE)) return null;
  return QUOTA_CONFIG_BY_TYPE[type as QuotaType];
};

export const resolveQuotaConfigForFile = (file: AuthFileItem): QuotaConfigByType | null => {
  if (CLAUDE_CONFIG.matchesFile(file)) return CLAUDE_CONFIG;
  if (ANTIGRAVITY_CONFIG.matchesFile(file)) return ANTIGRAVITY_CONFIG;
  if (CODEX_CONFIG.matchesFile(file)) return CODEX_CONFIG;
  if (GEMINI_CLI_CONFIG.matchesFile(file)) return GEMINI_CLI_CONFIG;
  if (KIMI_CONFIG.matchesFile(file)) return KIMI_CONFIG;
  return null;
};

async function refreshQuotaGroup<TState, TData>(
  config: QuotaConfig<TState, TData>,
  files: AuthFileItem[],
  t: TFunction
): Promise<QuotaRefreshResult[]> {
  const { ensureScope } = useQuotaStore.getState();
  const setQuota = useQuotaStore.getState()[config.storeSetter] as QuotaSetter<TState>;
  const scopeKey = getCurrentSessionScopeKey();

  ensureScope(scopeKey);

  setQuota({
    scopeKey,
    updater: (prev) => {
      const nextState: Record<string, TState> = { ...prev };
      files.forEach((file) => {
        nextState[file.name] = config.buildLoadingState();
      });
      return nextState;
    }
  });

  const results = await mapWithConcurrencyLimit(
    files,
    QUOTA_REFRESH_CONCURRENCY,
    async (file): Promise<QuotaRefreshResult> => {
      try {
        const data = await config.fetchQuota(file, t);
        setQuota({
          scopeKey,
          updater: (prev) => ({
            ...prev,
            [file.name]: config.buildSuccessState(data),
          })
        });
        return { name: file.name, status: 'success', configType: config.type };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const errorStatus = getStatusFromError(err);
        const searchText = getSearchTextFromError(err) ?? message;
        setQuota({
          scopeKey,
          updater: (prev) => ({
            ...prev,
            [file.name]: config.buildErrorState(message, errorStatus, searchText),
          })
        });
        return {
          name: file.name,
          status: 'error',
          configType: config.type,
          error: message,
          errorStatus,
        };
      }
    }
  );

  return results;
}

export async function refreshQuotaForFiles(
  files: AuthFileItem[],
  t: TFunction
): Promise<QuotaRefreshResult[]> {
  if (files.length === 0) return [];

  const grouped = new Map<string, { config: QuotaConfigByType; files: AuthFileItem[] }>();
  const skipped: QuotaRefreshResult[] = [];

  files.forEach((file) => {
    const config = resolveQuotaConfigForFile(file);
    if (!config) {
      skipped.push({ name: file.name, status: 'skipped' });
      return;
    }

    const group = grouped.get(config.type);
    if (group) {
      group.files.push(file);
      return;
    }

    grouped.set(config.type, { config, files: [file] });
  });

  const settled = await Promise.all(
    Array.from(grouped.values()).map(async ({ config, files: groupFiles }) => {
      switch (config.type) {
        case 'claude':
          return refreshQuotaGroup(CLAUDE_CONFIG, groupFiles, t);
        case 'antigravity':
          return refreshQuotaGroup(ANTIGRAVITY_CONFIG, groupFiles, t);
        case 'codex':
          return refreshQuotaGroup(CODEX_CONFIG, groupFiles, t);
        case 'gemini-cli':
          return refreshQuotaGroup(GEMINI_CLI_CONFIG, groupFiles, t);
        case 'kimi':
          return refreshQuotaGroup(KIMI_CONFIG, groupFiles, t);
        default:
          return [];
      }
    })
  );

  return [...settled.flat(), ...skipped];
}
