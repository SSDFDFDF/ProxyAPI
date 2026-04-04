import iconGemini from '@/assets/icons/gemini.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import iconAmp from '@/assets/icons/amp.svg';
import type { ResolvedTheme } from '@/features/authFiles/constants';

export type ProviderId = 'gemini' | 'codex' | 'claude' | 'vertex' | 'ampcode' | 'openai';

export interface ProviderCatalogItem {
  id: ProviderId;
  label: string;
  getIcon: (theme: ResolvedTheme) => string;
}

export const PROVIDER_CATALOG: ProviderCatalogItem[] = [
  { id: 'gemini', label: 'Gemini', getIcon: () => iconGemini },
  { id: 'codex', label: 'Codex', getIcon: () => iconCodex },
  { id: 'claude', label: 'Claude', getIcon: () => iconClaude },
  { id: 'vertex', label: 'Vertex', getIcon: () => iconVertex },
  { id: 'ampcode', label: 'Ampcode', getIcon: () => iconAmp },
  {
    id: 'openai',
    label: 'OpenAI',
    getIcon: (theme) => (theme === 'dark' ? iconOpenaiDark : iconOpenaiLight),
  },
];
