import { ampcodeApi } from '@/services/api';
import type { AmpcodeConfig } from '@/types';
import type { AmpcodeFormState } from '@/components/providers';
import {
  entriesToAmpcodeMappings,
  entriesToAmpcodeUpstreamApiKeys,
} from '@/components/providers/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { getCurrentSessionScopeKey } from '@/stores/serverState/sessionScope';

type SaveAmpcodeOptions = {
  loaded: boolean;
  modelMappingsDirty: boolean;
  upstreamApiKeysDirty: boolean;
  previousConfig: AmpcodeConfig | null | undefined;
};

const syncAmpcodeConfig = (
  config: AmpcodeConfig,
  scopeKey: string = getCurrentSessionScopeKey()
) => {
  useConfigStore.getState().updateConfigValue('ampcode', config, {
    scopeKey,
    invalidateCache: false,
  });
};

export const fetchAmpcodeConfig = async (): Promise<AmpcodeConfig> => {
  const ampcode = await ampcodeApi.getAmpcode();
  syncAmpcodeConfig(ampcode);
  return ampcode;
};

export const clearAmpcodeUpstreamApiKey = async (
  previousConfig: AmpcodeConfig | null | undefined
): Promise<AmpcodeConfig> => {
  await ampcodeApi.clearUpstreamApiKey();
  const next: AmpcodeConfig = { ...(previousConfig ?? {}) };
  delete next.upstreamApiKey;
  syncAmpcodeConfig(next);
  return next;
};

export const saveAmpcodeConfig = async (
  form: AmpcodeFormState,
  options: SaveAmpcodeOptions
): Promise<AmpcodeConfig> => {
  const upstreamUrl = form.upstreamUrl.trim();
  const overrideKey = form.upstreamApiKey.trim();
  const upstreamApiKeys = entriesToAmpcodeUpstreamApiKeys(form.upstreamApiKeyEntries);
  const modelMappings = entriesToAmpcodeMappings(form.mappingEntries);

  if (upstreamUrl) {
    await ampcodeApi.updateUpstreamUrl(upstreamUrl);
  } else {
    await ampcodeApi.clearUpstreamUrl();
  }

  await ampcodeApi.updateForceModelMappings(form.forceModelMappings);

  if (options.loaded || options.upstreamApiKeysDirty) {
    if (upstreamApiKeys.length) {
      await ampcodeApi.saveUpstreamApiKeys(upstreamApiKeys);
    } else {
      await ampcodeApi.deleteUpstreamApiKeys([]);
    }
  }

  if (options.loaded || options.modelMappingsDirty) {
    if (modelMappings.length) {
      await ampcodeApi.saveModelMappings(modelMappings);
    } else {
      await ampcodeApi.clearModelMappings();
    }
  }

  if (overrideKey) {
    await ampcodeApi.updateUpstreamApiKey(overrideKey);
  }

  const next: AmpcodeConfig = {
    ...(options.previousConfig ?? {}),
    forceModelMappings: form.forceModelMappings,
  };

  if (upstreamUrl) {
    next.upstreamUrl = upstreamUrl;
  } else {
    delete next.upstreamUrl;
  }

  if (overrideKey) {
    next.upstreamApiKey = overrideKey;
  } else {
    delete next.upstreamApiKey;
  }

  if (options.loaded || options.upstreamApiKeysDirty) {
    if (upstreamApiKeys.length) {
      next.upstreamApiKeys = upstreamApiKeys;
    } else {
      delete next.upstreamApiKeys;
    }
  }

  if (options.loaded || options.modelMappingsDirty) {
    if (modelMappings.length) {
      next.modelMappings = modelMappings;
    } else {
      delete next.modelMappings;
    }
  }

  syncAmpcodeConfig(next);
  return next;
};
