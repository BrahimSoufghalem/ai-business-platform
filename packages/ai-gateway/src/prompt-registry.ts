import type { AiPromptDefinition, AiTask } from './contracts.js';

function registryKey(task: AiTask, version: string): string {
  return `${task}:${version}`;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalized)) {
    throw new Error(`${label} must be a stable identifier.`);
  }
  return normalized;
}

export class PromptRegistry {
  readonly #prompts = new Map<string, AiPromptDefinition>();

  register(definition: AiPromptDefinition): void {
    const normalized: AiPromptDefinition = {
      id: requireIdentifier(definition.id, 'Prompt ID'),
      task: definition.task,
      version: requireIdentifier(definition.version, 'Prompt version'),
      systemInstruction: definition.systemInstruction.trim(),
    };
    if (normalized.systemInstruction.length === 0 || normalized.systemInstruction.length > 20_000) {
      throw new Error('System instruction must contain 1 to 20000 characters.');
    }
    const key = registryKey(normalized.task, normalized.version);
    if (this.#prompts.has(key)) {
      throw new Error(`Prompt ${key} is already registered and immutable.`);
    }
    this.#prompts.set(key, Object.freeze(normalized));
  }

  get(task: AiTask, version: string): AiPromptDefinition {
    const prompt = this.#prompts.get(registryKey(task, version));
    if (!prompt) throw new Error(`Prompt version ${task}:${version} is not registered.`);
    return prompt;
  }

  list(): readonly AiPromptDefinition[] {
    return Array.from(this.#prompts.values());
  }
}
