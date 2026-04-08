import { configApi } from '@/services/api';
import type { RawConfigSection } from '@/types/config';
import { useConfigStore } from '@/stores/useConfigStore';
import { getCurrentSessionScopeKey } from '@/stores/serverState/sessionScope';

type MutationOptions<TValue> = {
  rollbackValue?: TValue;
};

export const runOptimisticConfigSectionMutation = async <TValue, TResult>(
  section: RawConfigSection,
  nextValue: TValue,
  request: () => Promise<TResult>,
  options: MutationOptions<TValue> = {}
): Promise<TResult> => {
  const scopeKey = getCurrentSessionScopeKey();
  const { updateConfigValue, clearCache } = useConfigStore.getState();

  updateConfigValue(section, nextValue, { scopeKey, invalidateCache: true });

  try {
    const result = await request();
    clearCache(section, { scopeKey });
    return result;
  } catch (error) {
    if ('rollbackValue' in options) {
      updateConfigValue(section, options.rollbackValue as TValue, { scopeKey, invalidateCache: true });
    }
    throw error;
  }
};

export const syncConfigSectionSnapshot = <TValue>(
  section: RawConfigSection,
  value: TValue,
  scopeKey: string = getCurrentSessionScopeKey()
) => {
  useConfigStore.getState().updateConfigValue(section, value, {
    scopeKey,
    invalidateCache: false,
  });
};

export const updateRequestLogSetting = async (enabled: boolean, previousValue: boolean) =>
  runOptimisticConfigSectionMutation(
    'request-log',
    enabled,
    () => configApi.updateRequestLog(enabled),
    { rollbackValue: previousValue }
  );
