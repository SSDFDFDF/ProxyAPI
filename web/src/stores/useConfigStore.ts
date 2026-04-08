/**
 * 配置状态管理
 * 从原项目 src/core/config-service.js 迁移
 */

import { create } from 'zustand';
import type { Config } from '@/types';
import type { RawConfigSection } from '@/types/config';
import { configApi } from '@/services/api/config';
import { CACHE_EXPIRY_MS, STORAGE_KEY_SERVER_STATE_CONFIG } from '@/utils/constants';
import { ScopedQueryCache } from './serverState/scopedQueryCache';
import { buildSessionScopeKey, getCurrentSessionScopeKey } from './serverState/sessionScope';

type FetchConfigOptions = {
  forceRefresh?: boolean;
  scopeKey?: string;
};

type ConfigMutationOptions = {
  scopeKey?: string;
  invalidateCache?: boolean;
};

type ClearCacheOptions = {
  scopeKey?: string;
};

interface ConfigState {
  config: Config | null;
  scopeKey: string;
  loading: boolean;
  error: string | null;

  // 操作
  fetchConfig: {
    (section?: undefined, forceRefreshOrOptions?: boolean | FetchConfigOptions): Promise<Config>;
    (section: RawConfigSection, forceRefreshOrOptions?: boolean | FetchConfigOptions): Promise<unknown>;
  };
  updateConfigValue: (section: RawConfigSection, value: unknown, options?: ConfigMutationOptions) => void;
  clearCache: (section?: RawConfigSection, options?: ClearCacheOptions) => void;
  isCacheValid: (section?: RawConfigSection, scopeKeyOverride?: string) => boolean;
}

let configRequestToken = 0;
const FULL_CONFIG_QUERY_KEY = '__full__';
const configCache = new ScopedQueryCache<unknown>(STORAGE_KEY_SERVER_STATE_CONFIG);

const SECTION_KEYS: RawConfigSection[] = [
  'debug',
  'request-retry',
  'quota-exceeded',
  'usage-statistics-enabled',
  'request-log',
  'logging-to-file',
  'logs-max-total-size-mb',
  'ws-auth',
  'force-model-prefix',
  'routing/strategy',
  'api-keys',
  'ampcode',
  'gemini-api-key',
  'codex-api-key',
  'claude-api-key',
  'vertex-api-key',
  'openai-compatibility',
  'oauth-excluded-models'
];

const extractSectionValue = (config: Config | null, section?: RawConfigSection) => {
  if (!config) return undefined;
  switch (section) {
    case 'debug':
      return config.debug;
    case 'request-retry':
      return config.requestRetry;
    case 'quota-exceeded':
      return config.quotaExceeded;
    case 'usage-statistics-enabled':
      return config.usageStatisticsEnabled;
    case 'request-log':
      return config.requestLog;
    case 'logging-to-file':
      return config.loggingToFile;
    case 'logs-max-total-size-mb':
      return config.logsMaxTotalSizeMb;
    case 'ws-auth':
      return config.wsAuth;
    case 'force-model-prefix':
      return config.forceModelPrefix;
    case 'routing/strategy':
      return config.routingStrategy;
    case 'api-keys':
      return config.apiKeys;
    case 'ampcode':
      return config.ampcode;
    case 'gemini-api-key':
      return config.geminiApiKeys;
    case 'codex-api-key':
      return config.codexApiKeys;
    case 'claude-api-key':
      return config.claudeApiKeys;
    case 'vertex-api-key':
      return config.vertexApiKeys;
    case 'openai-compatibility':
      return config.openaiCompatibility;
    case 'oauth-excluded-models':
      return config.oauthExcludedModels;
    default:
      if (!section) return undefined;
      return config.raw?.[section];
  }
};

const hydrateConfigScopeState = (scopeKey: string): Pick<ConfigState, 'config'> => {
  const fullEntry = configCache.getEntry(scopeKey, FULL_CONFIG_QUERY_KEY);
  return {
    config: fullEntry?.data ? (fullEntry.data as Config) : null
  };
};

const buildConfigWithSectionValue = (
  current: Config | null,
  section: RawConfigSection,
  value: unknown
): Config => {
  const raw = { ...(current?.raw || {}) };
  raw[section] = value;
  const nextConfig: Config = { ...(current || {}), raw };

  switch (section) {
    case 'debug':
      nextConfig.debug = value as Config['debug'];
      break;
    case 'request-retry':
      nextConfig.requestRetry = value as Config['requestRetry'];
      break;
    case 'quota-exceeded':
      nextConfig.quotaExceeded = value as Config['quotaExceeded'];
      break;
    case 'usage-statistics-enabled':
      nextConfig.usageStatisticsEnabled = value as Config['usageStatisticsEnabled'];
      break;
    case 'request-log':
      nextConfig.requestLog = value as Config['requestLog'];
      break;
    case 'logging-to-file':
      nextConfig.loggingToFile = value as Config['loggingToFile'];
      break;
    case 'logs-max-total-size-mb':
      nextConfig.logsMaxTotalSizeMb = value as Config['logsMaxTotalSizeMb'];
      break;
    case 'ws-auth':
      nextConfig.wsAuth = value as Config['wsAuth'];
      break;
    case 'force-model-prefix':
      nextConfig.forceModelPrefix = value as Config['forceModelPrefix'];
      break;
    case 'routing/strategy':
      nextConfig.routingStrategy = value as Config['routingStrategy'];
      break;
    case 'api-keys':
      nextConfig.apiKeys = value as Config['apiKeys'];
      break;
    case 'ampcode':
      nextConfig.ampcode = value as Config['ampcode'];
      break;
    case 'gemini-api-key':
      nextConfig.geminiApiKeys = value as Config['geminiApiKeys'];
      break;
    case 'codex-api-key':
      nextConfig.codexApiKeys = value as Config['codexApiKeys'];
      break;
    case 'claude-api-key':
      nextConfig.claudeApiKeys = value as Config['claudeApiKeys'];
      break;
    case 'vertex-api-key':
      nextConfig.vertexApiKeys = value as Config['vertexApiKeys'];
      break;
    case 'openai-compatibility':
      nextConfig.openaiCompatibility = value as Config['openaiCompatibility'];
      break;
    case 'oauth-excluded-models':
      nextConfig.oauthExcludedModels = value as Config['oauthExcludedModels'];
      break;
    default:
      break;
  }

  return nextConfig;
};

const normalizeFetchConfigOptions = (
  forceRefreshOrOptions?: boolean | FetchConfigOptions
): FetchConfigOptions => {
  if (typeof forceRefreshOrOptions === 'boolean') {
    return { forceRefresh: forceRefreshOrOptions };
  }
  return forceRefreshOrOptions ?? {};
};

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  scopeKey: '',
  loading: false,
  error: null,

  fetchConfig: (async (section?: RawConfigSection, forceRefreshOrOptions?: boolean | FetchConfigOptions) => {
    const options = normalizeFetchConfigOptions(forceRefreshOrOptions);
    const forceRefresh = options.forceRefresh === true;
    const scopeKey = options.scopeKey ?? getCurrentSessionScopeKey();
    const state = get();

    if (state.scopeKey !== scopeKey) {
      const hydrated = hydrateConfigScopeState(scopeKey);
      set({
        ...hydrated,
        scopeKey,
        loading: false,
        error: null
      });
    }

    // 检查缓存
    const cacheKey = section || FULL_CONFIG_QUERY_KEY;
    if (!forceRefresh) {
      const cached = configCache.getFreshEntry(scopeKey, cacheKey, CACHE_EXPIRY_MS);
      if (cached) {
        if (!section) {
          set({
            config: cached.data as Config,
            scopeKey,
            loading: false,
            error: null
          });
        }
        return cached.data;
      }
    }

    // section 缓存未命中但 full 缓存可用时，直接复用已获取到的配置，避免重复 /config 请求
    if (!forceRefresh && section) {
      const fullCached = configCache.getFreshEntry(
        scopeKey,
        FULL_CONFIG_QUERY_KEY,
        CACHE_EXPIRY_MS
      );
      if (fullCached?.data) {
        return extractSectionValue(fullCached.data as Config, section);
      }
    }

    // 同一时刻合并多个 /config 请求（如 StrictMode 或多个页面同时触发）
    const inFlightRequest = configCache.getInFlight(scopeKey, FULL_CONFIG_QUERY_KEY);
    if (inFlightRequest) {
      const data = await inFlightRequest;
      return section ? extractSectionValue(data as Config, section) : data;
    }

    // 获取新数据
    set({ loading: true, error: null, scopeKey });

    const requestId = (configRequestToken += 1);
    const requestPromise = configApi.getConfig();
    configCache.setInFlight(scopeKey, FULL_CONFIG_QUERY_KEY, requestPromise);
    try {
      const data = await requestPromise;
      const now = Date.now();

      // 如果在请求过程中连接已被切换/登出，则忽略旧请求的结果，避免覆盖新会话的状态
      if (requestId !== configRequestToken) {
        return section ? extractSectionValue(data, section) : data;
      }

      // 更新缓存
      configCache.setEntry(scopeKey, FULL_CONFIG_QUERY_KEY, data, now);
      SECTION_KEYS.forEach((key) => {
        const value = extractSectionValue(data, key);
        if (value !== undefined) {
          configCache.setEntry(scopeKey, key, value, now);
        }
      });

      set({
        config: data,
        scopeKey,
        loading: false,
        error: null
      });

      return section ? extractSectionValue(data, section) : data;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to fetch config';
      if (requestId === configRequestToken) {
        set({
          error: message || 'Failed to fetch config',
          loading: false
        });
      }
      throw error;
    } finally {
      configCache.clearInFlight(scopeKey, FULL_CONFIG_QUERY_KEY, requestPromise);
    }
  }) as ConfigState['fetchConfig'],

  updateConfigValue: (section, value, options = {}) => {
    const targetScopeKey = options.scopeKey ?? (get().scopeKey || getCurrentSessionScopeKey());
    set((state) => {
      const isActiveScope = state.scopeKey === targetScopeKey;
      const nextConfig = buildConfigWithSectionValue(
        isActiveScope ? state.config : hydrateConfigScopeState(targetScopeKey).config,
        section,
        value
      );

      if (options.invalidateCache === false) {
        const now = Date.now();
        configCache.setEntry(targetScopeKey, FULL_CONFIG_QUERY_KEY, nextConfig, now);
        configCache.setEntry(targetScopeKey, section, value, now);
      }

      if (!isActiveScope) {
        return state;
      }

      return {
        config: nextConfig,
        scopeKey: targetScopeKey,
        error: null,
        loading: false
      };
    });

    if (options.invalidateCache !== false) {
      get().clearCache(section, { scopeKey: targetScopeKey });
    }
  },

  clearCache: (section, options = {}) => {
    const activeScopeKey = options.scopeKey ?? (get().scopeKey || getCurrentSessionScopeKey());

    if (section) {
      configCache.deleteEntry(activeScopeKey, section);
      // 同时清除完整配置缓存
      configCache.deleteEntry(activeScopeKey, FULL_CONFIG_QUERY_KEY);

      // Section-level invalidation usually follows an optimistic write path. Invalidate any in-flight
      // full fetch so stale responses can't overwrite newer local changes.
      configRequestToken += 1;
      configCache.clearInFlight(activeScopeKey, FULL_CONFIG_QUERY_KEY);

      set((state) => {
        if (state.scopeKey !== activeScopeKey) {
          return state;
        }
        return {
          scopeKey: activeScopeKey,
          loading: false,
          error: null
        };
      });
      return;
    }

    // 清除全部缓存一般代表“切换连接/登出/全量刷新”，需要让 in-flight 的旧请求失效
    configRequestToken += 1;
    configCache.clear();

    set({
      config: null,
      scopeKey: getCurrentSessionScopeKey(),
      loading: false,
      error: null
    });
  },

  isCacheValid: (section, scopeKeyOverride) => {
    const activeScopeKey = scopeKeyOverride ?? getCurrentSessionScopeKey();
    if (get().scopeKey !== activeScopeKey) {
      return false;
    }
    const cacheKey = section || FULL_CONFIG_QUERY_KEY;
    return configCache.isFresh(activeScopeKey, cacheKey, CACHE_EXPIRY_MS);
  }
}));

export const buildConfigScopeKey = (apiBase: string, managementKey: string) =>
  buildSessionScopeKey(apiBase, managementKey);
