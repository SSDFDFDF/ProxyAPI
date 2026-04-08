import { providersApi } from '@/services/api';
import type {
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import { useConfigStore } from '@/stores/useConfigStore';
import { getCurrentSessionScopeKey } from '@/stores/serverState/sessionScope';
import { runOptimisticConfigSectionMutation } from '@/domains/config/mutations';

type ProviderConfigSection =
  | 'gemini-api-key'
  | 'codex-api-key'
  | 'claude-api-key'
  | 'vertex-api-key'
  | 'openai-compatibility';

const saveProviderList = <TList, TResult>(
  section: ProviderConfigSection,
  nextList: TList,
  request: () => Promise<TResult>,
  previousList?: TList
) =>
  runOptimisticConfigSectionMutation(
    section,
    nextList,
    request,
    previousList === undefined ? {} : { rollbackValue: previousList }
  );

const deleteProviderEntry = <TList, TResult>(
  section: ProviderConfigSection,
  nextList: TList,
  previousList: TList,
  request: () => Promise<TResult>
) =>
  runOptimisticConfigSectionMutation(
    section,
    nextList,
    request,
    { rollbackValue: previousList }
  );

export const saveGeminiProviderList = async (
  nextList: GeminiKeyConfig[],
  previousList?: GeminiKeyConfig[]
) =>
  saveProviderList(
    'gemini-api-key',
    nextList,
    () => providersApi.saveGeminiKeys(nextList),
    previousList
  );

export const deleteGeminiProvider = async (
  apiKey: string,
  nextList: GeminiKeyConfig[],
  previousList: GeminiKeyConfig[]
) =>
  deleteProviderEntry(
    'gemini-api-key',
    nextList,
    previousList,
    () => providersApi.deleteGeminiKey(apiKey)
  );

export const saveCodexProviderList = async (
  nextList: ProviderKeyConfig[],
  previousList?: ProviderKeyConfig[]
) =>
  saveProviderList(
    'codex-api-key',
    nextList,
    () => providersApi.saveCodexConfigs(nextList),
    previousList
  );

export const deleteCodexProvider = async (
  apiKey: string,
  nextList: ProviderKeyConfig[],
  previousList: ProviderKeyConfig[]
) =>
  deleteProviderEntry(
    'codex-api-key',
    nextList,
    previousList,
    () => providersApi.deleteCodexConfig(apiKey)
  );

export const saveClaudeProviderList = async (
  nextList: ProviderKeyConfig[],
  previousList?: ProviderKeyConfig[]
) =>
  saveProviderList(
    'claude-api-key',
    nextList,
    () => providersApi.saveClaudeConfigs(nextList),
    previousList
  );

export const deleteClaudeProvider = async (
  apiKey: string,
  nextList: ProviderKeyConfig[],
  previousList: ProviderKeyConfig[]
) =>
  deleteProviderEntry(
    'claude-api-key',
    nextList,
    previousList,
    () => providersApi.deleteClaudeConfig(apiKey)
  );

export const saveVertexProviderList = async (
  nextList: ProviderKeyConfig[],
  previousList?: ProviderKeyConfig[]
) =>
  saveProviderList(
    'vertex-api-key',
    nextList,
    () => providersApi.saveVertexConfigs(nextList),
    previousList
  );

export const deleteVertexProvider = async (
  apiKey: string,
  nextList: ProviderKeyConfig[],
  previousList: ProviderKeyConfig[]
) =>
  deleteProviderEntry(
    'vertex-api-key',
    nextList,
    previousList,
    () => providersApi.deleteVertexConfig(apiKey)
  );

export const saveOpenAIProviderList = async (
  nextList: OpenAIProviderConfig[],
  previousList?: OpenAIProviderConfig[]
): Promise<OpenAIProviderConfig[]> => {
  const scopeKey = getCurrentSessionScopeKey();

  await saveProviderList(
    'openai-compatibility',
    nextList,
    () => providersApi.saveOpenAIProviders(nextList),
    previousList
  );

  try {
    const latest = await useConfigStore.getState().fetchConfig('openai-compatibility', {
      forceRefresh: true,
      scopeKey,
    });
    if (Array.isArray(latest)) {
      const synced = latest as OpenAIProviderConfig[];
      useConfigStore.getState().updateConfigValue('openai-compatibility', synced, {
        scopeKey,
        invalidateCache: false,
      });
      return synced;
    }
  } catch {
    // Fall back to the local list if the post-save sync request fails.
  }

  return nextList;
};

export const deleteOpenAIProvider = async (
  name: string,
  nextList: OpenAIProviderConfig[],
  previousList: OpenAIProviderConfig[]
) =>
  deleteProviderEntry(
    'openai-compatibility',
    nextList,
    previousList,
    () => providersApi.deleteOpenAIProvider(name)
  );
