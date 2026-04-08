import { useCallback, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AmpcodeSection,
  ClaudeSection,
  CodexSection,
  GeminiSection,
  OpenAISection,
  PROVIDER_CATALOG,
  VertexSection,
  type ProviderId,
  useProviderStats,
} from '@/components/providers';
import { PageFilterSection } from '@/components/ui/PageFilterSection';
import { FilterTabs, type FilterTabItem } from '@/components/ui/FilterTabs';
import { PageTitleBlock } from '@/components/ui/PageTitleBlock';
import {
  hasAmpcodeConfigContent,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { ampcodeApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore, useThemeStore } from '@/stores';
import { getTypeColor, type ResolvedTheme } from '@/features/authFiles/constants';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import styles from './AiProvidersPage.module.scss';
import { syncConfigSectionSnapshot } from '@/domains/config/mutations';
import {
  deleteClaudeProvider,
  deleteCodexProvider,
  deleteGeminiProvider,
  deleteOpenAIProvider,
  deleteVertexProvider,
  saveClaudeProviderList,
  saveCodexProviderList,
  saveGeminiProviderList,
  saveVertexProviderList,
} from '@/domains/providers/mutations';

export function AiProvidersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const hasMounted = useRef(false);
  const [loading, setLoading] = useState(() => !isCacheValid());
  const [error, setError] = useState('');

  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyConfig[]>(
    () => config?.geminiApiKeys || []
  );
  const [codexConfigs, setCodexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.codexApiKeys || []
  );
  const [claudeConfigs, setClaudeConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.claudeApiKeys || []
  );
  const [vertexConfigs, setVertexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.vertexApiKeys || []
  );
  const [openaiProviders, setOpenaiProviders] = useState<OpenAIProviderConfig[]>(
    () => config?.openaiCompatibility || []
  );

  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);
  const hasUserSelectedProviderRef = useRef(false);

  const disableControls = connectionStatus !== 'connected';
  const isSwitching = Boolean(configSwitchingKey);

  const { keyStats, usageDetails, loadKeyStats, refreshKeyStats } = useProviderStats();

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const loadConfigs = useCallback(async () => {
    const hasValidCache = isCacheValid();
    if (!hasValidCache) {
      setLoading(true);
    }
    setError('');
    try {
      const [configResult, vertexResult, ampcodeResult] = await Promise.allSettled([
        fetchConfig(),
        providersApi.getVertexConfigs(),
        ampcodeApi.getAmpcode(),
      ]);

      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }

      const data = configResult.value;
      setGeminiKeys(data?.geminiApiKeys || []);
      setCodexConfigs(data?.codexApiKeys || []);
      setClaudeConfigs(data?.claudeApiKeys || []);
      setVertexConfigs(data?.vertexApiKeys || []);
      setOpenaiProviders(data?.openaiCompatibility || []);

      if (vertexResult.status === 'fulfilled') {
        setVertexConfigs(vertexResult.value || []);
        syncConfigSectionSnapshot('vertex-api-key', vertexResult.value || []);
      }

      if (ampcodeResult.status === 'fulfilled') {
        syncConfigSectionSnapshot('ampcode', ampcodeResult.value);
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchConfig, isCacheValid, t]);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    loadConfigs();
    void loadKeyStats().catch(() => {});
  }, [loadConfigs, loadKeyStats]);

  useEffect(() => {
    if (config?.geminiApiKeys) setGeminiKeys(config.geminiApiKeys);
    if (config?.codexApiKeys) setCodexConfigs(config.codexApiKeys);
    if (config?.claudeApiKeys) setClaudeConfigs(config.claudeApiKeys);
    if (config?.vertexApiKeys) setVertexConfigs(config.vertexApiKeys);
    if (config?.openaiCompatibility) setOpenaiProviders(config.openaiCompatibility);
  }, [
    config?.geminiApiKeys,
    config?.codexApiKeys,
    config?.claudeApiKeys,
    config?.vertexApiKeys,
    config?.openaiCompatibility,
  ]);

  useHeaderRefresh(refreshKeyStats);

  const providerCounts = useMemo<Record<ProviderId, number>>(
    () => ({
      gemini: geminiKeys.length,
      codex: codexConfigs.length,
      claude: claudeConfigs.length,
      vertex: vertexConfigs.length,
      ampcode: hasAmpcodeConfigContent(config?.ampcode) ? 1 : 0,
      openai: openaiProviders.length,
    }),
    [
      claudeConfigs.length,
      codexConfigs.length,
      config?.ampcode,
      geminiKeys.length,
      openaiProviders.length,
      vertexConfigs.length,
    ]
  );

  const totalConfigCount = useMemo(
    () => Object.values(providerCounts).reduce((sum, count) => sum + count, 0),
    [providerCounts]
  );

  const defaultProvider = useMemo<ProviderId>(
    () => PROVIDER_CATALOG.find((provider) => providerCounts[provider.id] > 0)?.id ?? 'gemini',
    [providerCounts]
  );
  const [activeProvider, setActiveProvider] = useState<ProviderId>(defaultProvider);

  const resolveProviderTabColor = useCallback(
    (providerId: ProviderId): { bg: string; text: string } => {
      if (providerId === 'openai') {
        return resolvedTheme === 'dark'
          ? { bg: '#163c2d', text: '#81d9af' }
          : { bg: '#e4f7ed', text: '#117a4d' };
      }
      if (providerId === 'ampcode') {
        return resolvedTheme === 'dark'
          ? { bg: '#403523', text: '#f3d18e' }
          : { bg: '#fff3dc', text: '#a96d08' };
      }
      return getTypeColor(providerId, resolvedTheme as ResolvedTheme);
    },
    [resolvedTheme]
  );

  useEffect(() => {
    setActiveProvider((previousProvider) => {
      if (hasUserSelectedProviderRef.current) {
        return previousProvider ?? defaultProvider;
      }
      if (providerCounts[previousProvider] > 0) {
        return previousProvider;
      }
      return defaultProvider;
    });
  }, [defaultProvider, providerCounts]);

  const handleProviderTabClick = useCallback((providerId: ProviderId) => {
    hasUserSelectedProviderRef.current = true;
    setActiveProvider(providerId);
  }, []);

  const providerTabItems = useMemo<FilterTabItem[]>(
    () =>
      PROVIDER_CATALOG.map((provider) => {
        const color = resolveProviderTabColor(provider.id);
        const buttonStyle = {
          '--filter-color': color.text,
          '--filter-surface': color.bg,
          '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
        } as CSSProperties;

        return {
          id: provider.id,
          label: provider.label,
          active: activeProvider === provider.id,
          count: providerCounts[provider.id],
          style: buttonStyle,
          icon: (
            <img
              src={provider.getIcon(resolvedTheme as ResolvedTheme)}
              alt=""
              className={styles.providerFilterIcon}
            />
          ),
          onClick: () => handleProviderTabClick(provider.id),
        };
      }),
    [activeProvider, handleProviderTabClick, providerCounts, resolveProviderTabColor, resolvedTheme]
  );

  const openEditor = useCallback(
    (path: string) => {
      navigate(path, { state: { fromAiProviders: true } });
    },
    [navigate]
  );

  const deleteGemini = useCallback(async (index: number) => {
    const entry = geminiKeys[index];
    if (!entry) return;
    showConfirmation({
      title: t('common.delete'),
      message: t('ai_providers.gemini_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          const next = geminiKeys.filter((_, idx) => idx !== index);
          await deleteGeminiProvider(entry.apiKey, next, geminiKeys);
          setGeminiKeys(next);
          showNotification(t('notification.gemini_key_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  }, [geminiKeys, showConfirmation, showNotification, t]);

  const setConfigEnabled = useCallback(async (
    provider: 'gemini' | 'codex' | 'claude' | 'vertex',
    index: number,
    enabled: boolean
  ) => {
    if (provider === 'gemini') {
      const current = geminiKeys[index];
      if (!current) return;

      const switchingKey = `${provider}:${current.apiKey}`;
      setConfigSwitchingKey(switchingKey);

      const previousList = geminiKeys;
      const nextExcluded = enabled
        ? withoutDisableAllModelsRule(current.excludedModels)
        : withDisableAllModelsRule(current.excludedModels);
      const nextItem: GeminiKeyConfig = { ...current, excludedModels: nextExcluded };
      const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

      setGeminiKeys(nextList);

      try {
        await saveGeminiProviderList(nextList, previousList);
        showNotification(
          enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
          'success'
        );
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        setGeminiKeys(previousList);
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
      } finally {
        setConfigSwitchingKey(null);
      }
      return;
    }

    const source =
      provider === 'codex'
        ? codexConfigs
        : provider === 'claude'
          ? claudeConfigs
          : vertexConfigs;
    const current = source[index];
    if (!current) return;

    const switchingKey = `${provider}:${current.apiKey}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = source;
    const nextExcluded = enabled
      ? withoutDisableAllModelsRule(current.excludedModels)
      : withDisableAllModelsRule(current.excludedModels);
    const nextItem: ProviderKeyConfig = { ...current, excludedModels: nextExcluded };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    if (provider === 'codex') {
      setCodexConfigs(nextList);
    } else if (provider === 'claude') {
      setClaudeConfigs(nextList);
    } else {
      setVertexConfigs(nextList);
    }

    try {
      if (provider === 'codex') {
        await saveCodexProviderList(nextList, previousList);
      } else if (provider === 'claude') {
        await saveClaudeProviderList(nextList, previousList);
      } else {
        await saveVertexProviderList(nextList, previousList);
      }
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (provider === 'codex') {
        setCodexConfigs(previousList);
      } else if (provider === 'claude') {
        setClaudeConfigs(previousList);
      } else {
        setVertexConfigs(previousList);
      }
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  }, [
    claudeConfigs,
    codexConfigs,
    geminiKeys,
    setClaudeConfigs,
    setCodexConfigs,
    setGeminiKeys,
    setVertexConfigs,
    showNotification,
    t,
    vertexConfigs,
  ]);

  const deleteProviderEntry = useCallback(async (type: 'codex' | 'claude', index: number) => {
    const source = type === 'codex' ? codexConfigs : claudeConfigs;
    const entry = source[index];
    if (!entry) return;
    showConfirmation({
      title: t('common.delete'),
      message: t(`ai_providers.${type}_delete_confirm`),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          if (type === 'codex') {
            const next = codexConfigs.filter((_, idx) => idx !== index);
            await deleteCodexProvider(entry.apiKey, next, codexConfigs);
            setCodexConfigs(next);
            showNotification(t('notification.codex_config_deleted'), 'success');
          } else {
            const next = claudeConfigs.filter((_, idx) => idx !== index);
            await deleteClaudeProvider(entry.apiKey, next, claudeConfigs);
            setClaudeConfigs(next);
            showNotification(t('notification.claude_config_deleted'), 'success');
          }
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  }, [claudeConfigs, codexConfigs, showConfirmation, showNotification, t]);

  const deleteVertex = useCallback(async (index: number) => {
    const entry = vertexConfigs[index];
    if (!entry) return;
    showConfirmation({
      title: t('common.delete'),
      message: t('ai_providers.vertex_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          const next = vertexConfigs.filter((_, idx) => idx !== index);
          await deleteVertexProvider(entry.apiKey, next, vertexConfigs);
          setVertexConfigs(next);
          showNotification(t('notification.vertex_config_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  }, [showConfirmation, showNotification, t, vertexConfigs]);

  const deleteOpenai = useCallback(async (index: number) => {
    const entry = openaiProviders[index];
    if (!entry) return;
    showConfirmation({
      title: t('common.delete'),
      message: t('ai_providers.openai_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          const next = openaiProviders.filter((_, idx) => idx !== index);
          await deleteOpenAIProvider(entry.name, next, openaiProviders);
          setOpenaiProviders(next);
          showNotification(t('notification.openai_provider_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  }, [openaiProviders, showConfirmation, showNotification, t]);

  const activeProviderSection = useMemo(() => {
    switch (activeProvider) {
      case 'gemini':
        return (
          <GeminiSection
            configs={geminiKeys}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/gemini/new')}
            onEdit={(index) => openEditor(`/ai-providers/gemini/${index}`)}
            onDelete={deleteGemini}
            onToggle={(index, enabled) => void setConfigEnabled('gemini', index, enabled)}
          />
        );
      case 'codex':
        return (
          <CodexSection
            configs={codexConfigs}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/codex/new')}
            onEdit={(index) => openEditor(`/ai-providers/codex/${index}`)}
            onDelete={(index) => void deleteProviderEntry('codex', index)}
            onToggle={(index, enabled) => void setConfigEnabled('codex', index, enabled)}
          />
        );
      case 'claude':
        return (
          <ClaudeSection
            configs={claudeConfigs}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/claude/new')}
            onEdit={(index) => openEditor(`/ai-providers/claude/${index}`)}
            onDelete={(index) => void deleteProviderEntry('claude', index)}
            onToggle={(index, enabled) => void setConfigEnabled('claude', index, enabled)}
          />
        );
      case 'vertex':
        return (
          <VertexSection
            configs={vertexConfigs}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/vertex/new')}
            onEdit={(index) => openEditor(`/ai-providers/vertex/${index}`)}
            onDelete={deleteVertex}
            onToggle={(index, enabled) => void setConfigEnabled('vertex', index, enabled)}
          />
        );
      case 'ampcode':
        return (
          <AmpcodeSection
            config={config?.ampcode}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onEdit={() => openEditor('/ai-providers/ampcode')}
          />
        );
      case 'openai':
      default:
        return (
          <OpenAISection
            configs={openaiProviders}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            resolvedTheme={resolvedTheme}
            onAdd={() => openEditor('/ai-providers/openai/new')}
            onEdit={(index) => openEditor(`/ai-providers/openai/${index}`)}
            onDelete={deleteOpenai}
          />
        );
    }
  }, [
    activeProvider,
    claudeConfigs,
    codexConfigs,
    config?.ampcode,
    deleteGemini,
    deleteProviderEntry,
    deleteOpenai,
    deleteVertex,
    disableControls,
    geminiKeys,
    isSwitching,
    keyStats,
    loading,
    openEditor,
    openaiProviders,
    resolvedTheme,
    setConfigEnabled,
    usageDetails,
    vertexConfigs,
  ]);

  return (
    <div className={styles.container}>
      <PageTitleBlock
        title={t('ai_providers.title')}
        description={t('ai_providers.description', {
          defaultValue: '集中管理各 AI 提供商配置、模型与连接状态。',
        })}
        count={totalConfigCount}
      />
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}
        <PageFilterSection>
          <FilterTabs items={providerTabItems} />
        </PageFilterSection>
        {activeProviderSection}
      </div>
    </div>
  );
}
