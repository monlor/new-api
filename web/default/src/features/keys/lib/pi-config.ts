/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { getModelLimit } from './model-limits'
import {
  modelSupportsReasoning,
  modelSupportsVision,
  normalizeCompatBaseUrl,
  uniqueModels,
} from './model-meta'
import { toOpenCodeProviderId } from './opencode-config'

// Pi custom-provider defaults: https://pi.dev/docs/latest/models
export const PI_API_OPENAI_COMPLETIONS = 'openai-completions'

// Official Pi KnownProvider ids from packages/ai/src/types.ts, plus gemini alias.
const PI_RESERVED_PROVIDER_IDS = new Set([
  'amazon-bedrock',
  'ant-ling',
  'anthropic',
  'azure-openai-responses',
  'baseten',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'deepseek',
  'fireworks',
  'gemini',
  'github-copilot',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'qwen-token-plan-individual',
  'radius',
  'together',
  'vercel-ai-gateway',
  'xai',
  'xiaomi',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'zai',
  'zai-coding-cn',
])

export type PiModelInput = {
  id: string
  name: string
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
  maxTokens: number
}

export type PiConfigInput = {
  apiKey: string
  baseUrl: string
  providerName: string
  providerId?: string
  models: string[]
}

export function toPiProviderId(name: string): string {
  const slug = toOpenCodeProviderId(name)
  return PI_RESERVED_PROVIDER_IDS.has(slug) ? `newapi-${slug}` : slug
}

export function buildPiModelEntry(model: string): PiModelInput {
  const limit = getModelLimit(model)
  return {
    id: model,
    name: model,
    reasoning: modelSupportsReasoning(model),
    input: modelSupportsVision(model) ? ['text', 'image'] : ['text'],
    contextWindow: limit.context,
    maxTokens: limit.output,
  }
}

export function toPiAuthProviderId(input: PiConfigInput): string {
  return toPiProviderId(input.providerId || input.providerName)
}

export function buildPiProvider(input: PiConfigInput): Record<string, unknown> {
  return {
    name:
      input.providerName ||
      toPiProviderId(input.providerId || input.providerName),
    baseUrl: normalizeCompatBaseUrl(input.baseUrl),
    api: PI_API_OPENAI_COMPLETIONS,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    models: uniqueModels(input.models).map(buildPiModelEntry),
  }
}

export function buildPiModelsJson(input: PiConfigInput): string {
  const providerId = toPiAuthProviderId(input)
  return JSON.stringify(
    {
      providers: {
        [providerId]: buildPiProvider(input),
      },
    },
    null,
    2
  )
}

// Official credential store: https://pi.dev/docs/latest/providers
export function buildPiAuthJson(input: PiConfigInput): string {
  const providerId = toPiAuthProviderId(input)
  return JSON.stringify(
    {
      [providerId]: {
        type: 'api_key',
        key: input.apiKey,
      },
    },
    null,
    2
  )
}
