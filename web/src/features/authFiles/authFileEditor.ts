import {
  applyCodexAuthFileWebsockets,
  parseDisableCoolingValue,
  parseExcludedModelsText,
  parsePriorityValue,
} from '@/features/authFiles/constants';

export type AuthFileEditableValues = {
  prefix: string;
  proxyUrl: string;
  priority: string;
  excludedModelsText: string;
  disableCooling: string;
  websockets: boolean;
  note: string;
  noteTouched?: boolean;
};

export type AuthFileEditableEnabled = Partial<
  Record<
    'prefix' | 'proxyUrl' | 'priority' | 'excludedModelsText' | 'disableCooling' | 'websockets' | 'note',
    boolean
  >
>;

type ApplyOptions = {
  isCodexFile: boolean;
  enabled?: AuthFileEditableEnabled;
  respectNoteTouched?: boolean;
};

const isEnabled = (enabled: AuthFileEditableEnabled | undefined, key: keyof AuthFileEditableEnabled) =>
  enabled ? enabled[key] === true : true;

export function applyAuthFileEditableValues(
  json: Record<string, unknown>,
  values: AuthFileEditableValues,
  options: ApplyOptions
): Record<string, unknown> {
  const { isCodexFile, enabled, respectNoteTouched = false } = options;
  const next: Record<string, unknown> = { ...json };

  if (isEnabled(enabled, 'prefix') && ('prefix' in next || values.prefix.trim())) {
    next.prefix = values.prefix;
  }

  if (isEnabled(enabled, 'proxyUrl') && ('proxy_url' in next || values.proxyUrl.trim())) {
    next.proxy_url = values.proxyUrl;
  }

  if (isEnabled(enabled, 'priority')) {
    const parsedPriority = parsePriorityValue(values.priority);
    if (parsedPriority !== undefined) {
      next.priority = parsedPriority;
    } else if ('priority' in next) {
      delete next.priority;
    }
  }

  if (isEnabled(enabled, 'excludedModelsText')) {
    const excludedModels = parseExcludedModelsText(values.excludedModelsText);
    if (excludedModels.length > 0) {
      next.excluded_models = excludedModels;
    } else if ('excluded_models' in next) {
      delete next.excluded_models;
    }
  }

  if (isEnabled(enabled, 'disableCooling')) {
    const parsedDisableCooling = parseDisableCoolingValue(values.disableCooling);
    if (parsedDisableCooling !== undefined) {
      next.disable_cooling = parsedDisableCooling;
    } else if ('disable_cooling' in next) {
      delete next.disable_cooling;
    }
  }

  if (isEnabled(enabled, 'note') && (!respectNoteTouched || values.noteTouched)) {
    const noteValue = values.note.trim();
    if (noteValue) {
      next.note = values.note;
    } else if ('note' in next) {
      delete next.note;
    }
  }

  if (isEnabled(enabled, 'websockets') && isCodexFile) {
    return applyCodexAuthFileWebsockets(next, values.websockets);
  }

  return next;
}
