import type { TFunction } from 'i18next';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { QUOTA_REFRESH_CONCURRENCY } from '@/utils/constants';
import { mapWithConcurrencyLimit } from '@/utils/async';
import { getStatusFromError } from '@/utils/quota';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  type QuotaConfig,
} from './quotaConfigs';

type AnyQuotaConfig = QuotaConfig<any, any>;
type QuotaSetter = (updater: unknown) => void;

export type QuotaRefreshResult = {
  name: string;
  status: 'success' | 'error' | 'skipped';
  configType?: string;
  error?: string;
  errorStatus?: number;
};

export const QUOTA_CONFIGS: AnyQuotaConfig[] = [
  CLAUDE_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
];

export const getQuotaConfigByType = (type: string): AnyQuotaConfig | null =>
  QUOTA_CONFIGS.find((config) => config.type === type) ?? null;

export const resolveQuotaConfigForFile = (file: AuthFileItem): AnyQuotaConfig | null =>
  QUOTA_CONFIGS.find((config) => config.filterFn(file)) ?? null;

const getQuotaSetter = (config: AnyQuotaConfig): QuotaSetter =>
  useQuotaStore.getState()[config.storeSetter] as QuotaSetter;

async function refreshQuotaGroup(
  config: AnyQuotaConfig,
  files: AuthFileItem[],
  t: TFunction
): Promise<QuotaRefreshResult[]> {
  const setQuota = getQuotaSetter(config);

  setQuota((prev: Record<string, unknown>) => {
    const nextState = { ...prev };
    files.forEach((file) => {
      nextState[file.name] = config.buildLoadingState();
    });
    return nextState;
  });

  const results = await mapWithConcurrencyLimit(
    files,
    QUOTA_REFRESH_CONCURRENCY,
    async (file): Promise<QuotaRefreshResult> => {
      try {
        const data = await config.fetchQuota(file, t);
        setQuota((prev: Record<string, unknown>) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data),
        }));
        return { name: file.name, status: 'success', configType: config.type };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const errorStatus = getStatusFromError(err);
        setQuota((prev: Record<string, unknown>) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, errorStatus),
        }));
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

  const grouped = new Map<string, { config: AnyQuotaConfig; files: AuthFileItem[] }>();
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
    Array.from(grouped.values()).map(({ config, files: groupFiles }) =>
      refreshQuotaGroup(config, groupFiles, t)
    )
  );

  return [...settled.flat(), ...skipped];
}
