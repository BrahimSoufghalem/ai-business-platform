export type AgentLanguage = 'ar' | 'fr' | 'en';
export type AgentTone = 'professional' | 'friendly' | 'concise' | 'warm';

export interface AgentSettings {
  readonly language: AgentLanguage;
  readonly tone: AgentTone;
  readonly handoffNotes: string;
}

const allowedLanguages: readonly AgentLanguage[] = ['ar', 'fr', 'en'];
const allowedTones: readonly AgentTone[] = ['professional', 'friendly', 'concise', 'warm'];

function hasUnsupportedControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    );
  });
}

export function normalizeAgentSettings(settings: AgentSettings): AgentSettings {
  if (!allowedLanguages.includes(settings.language)) {
    throw new Error('Agent language is not supported.');
  }
  if (!allowedTones.includes(settings.tone)) {
    throw new Error('Agent tone is not supported.');
  }
  const handoffNotes = settings.handoffNotes.trim();
  if (handoffNotes.length > 1_000) {
    throw new Error('Handoff notes cannot exceed 1000 characters.');
  }
  if (hasUnsupportedControlCharacters(handoffNotes)) {
    throw new Error('Handoff notes contain unsupported control characters.');
  }
  return {
    language: settings.language,
    tone: settings.tone,
    handoffNotes,
  };
}
