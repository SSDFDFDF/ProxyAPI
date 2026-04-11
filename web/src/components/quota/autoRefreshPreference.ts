import { obfuscatedStorage } from '@/services/storage/secureStorage';
import {
  SERVER_STATE_PERSIST_MAX_SCOPES,
  STORAGE_KEY_QUOTA_AUTO_REFRESH,
} from '@/utils/constants';

type QuotaAutoRefreshPreferenceEntry = {
  scopeKey: string;
  enabled: boolean;
  updatedAt: number;
};

type PersistedQuotaAutoRefreshPreferences = {
  version: 1;
  scopes: QuotaAutoRefreshPreferenceEntry[];
};

const buildEmptyPreferences = (): PersistedQuotaAutoRefreshPreferences => ({
  version: 1,
  scopes: [],
});

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const normalizePreferenceEntry = (value: unknown): QuotaAutoRefreshPreferenceEntry | null => {
  if (!value || typeof value !== 'object') return null;

  const entry = value as Partial<QuotaAutoRefreshPreferenceEntry>;
  const scopeKey = typeof entry.scopeKey === 'string' ? entry.scopeKey.trim() : '';
  if (!scopeKey) return null;

  return {
    scopeKey,
    enabled: entry.enabled === true,
    updatedAt:
      typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : 0,
  };
};

const readPreferences = (): PersistedQuotaAutoRefreshPreferences => {
  if (!canUseStorage()) return buildEmptyPreferences();

  const stored = obfuscatedStorage.getItem<PersistedQuotaAutoRefreshPreferences>(
    STORAGE_KEY_QUOTA_AUTO_REFRESH,
    {
      obfuscate: true,
    }
  );

  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.scopes)) {
    return buildEmptyPreferences();
  }

  return {
    version: 1,
    scopes: stored.scopes.map(normalizePreferenceEntry).filter(Boolean) as QuotaAutoRefreshPreferenceEntry[],
  };
};

const writePreferences = (preferences: PersistedQuotaAutoRefreshPreferences) => {
  if (!canUseStorage()) return;
  obfuscatedStorage.setItem(STORAGE_KEY_QUOTA_AUTO_REFRESH, preferences, { obfuscate: true });
};

export const readQuotaAutoRefreshEnabled = (scopeKey: string): boolean => {
  const normalizedScopeKey = String(scopeKey ?? '').trim();
  if (!normalizedScopeKey) return false;

  const entry = readPreferences().scopes.find((item) => item.scopeKey === normalizedScopeKey);
  return entry?.enabled === true;
};

export const writeQuotaAutoRefreshEnabled = (scopeKey: string, enabled: boolean) => {
  const normalizedScopeKey = String(scopeKey ?? '').trim();
  if (!normalizedScopeKey) return;

  const nextEntry: QuotaAutoRefreshPreferenceEntry = {
    scopeKey: normalizedScopeKey,
    enabled,
    updatedAt: Date.now(),
  };
  const preferences = readPreferences();
  const nextScopes = [
    nextEntry,
    ...preferences.scopes.filter((item) => item.scopeKey !== normalizedScopeKey),
  ].slice(0, SERVER_STATE_PERSIST_MAX_SCOPES);

  writePreferences({
    version: 1,
    scopes: nextScopes,
  });
};
