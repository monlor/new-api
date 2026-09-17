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
import {
  DEFAULT_MODEL_CONTEXT,
  DEFAULT_MODEL_OUTPUT,
  getModelLimit,
  normalizeModelId,
  type ModelLimit,
} from './model-limits'
import {
  modelSupportsVision,
  normalizeCompatBaseUrl,
  uniqueModels,
} from './model-meta'

// OpenCode custom-provider defaults from official docs:
// https://opencode.ai/docs/providers/ and https://opencode.ai/docs/models/
// Unknown catalog models assume 200k context / 32k output.
export const OPENCODE_DEFAULT_CONTEXT = DEFAULT_MODEL_CONTEXT
export const OPENCODE_DEFAULT_OUTPUT = DEFAULT_MODEL_OUTPUT
export const OPENCODE_NPM_OPENAI_COMPATIBLE = '@ai-sdk/openai-compatible'
export const OPENCODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json'

export type OpenCodeModelEntry = {
  name: string
  limit: ModelLimit
  capabilities: {
    tools: boolean
    input: Array<'text' | 'image'>
    output: Array<'text'>
  }
}

export type OpenCodeConfigInput = {
  apiKey: string
  baseUrl: string
  providerName: string
  providerId?: string
  defaultModel: string
  smallModel?: string
  models: string[]
}

export {
  endpointMapFromPricing,
  filterChatModels,
  isChatModel,
} from './chat-models'

export function toOpenCodeProviderId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'newapi'
}

function isSmallModelCandidate(model: string, defaultModel: string): boolean {
  if (model === defaultModel) return false
  const id = normalizeModelId(model)
  return /haiku|mini|flash|lite|nano|small/.test(id)
}

const PREFERRED_SMALL_MODELS = ['gpt-5.6-luna']

export function pickOpenCodeSmallModel(
  models: string[],
  defaultModel: string
): string | undefined {
  const unique = uniqueModels(models)
  for (const preferred of PREFERRED_SMALL_MODELS) {
    const match = unique.find(
      (model) =>
        model !== defaultModel &&
        (model === preferred || normalizeModelId(model) === preferred)
    )
    if (match) return match
  }
  return unique.find((model) => isSmallModelCandidate(model, defaultModel))
}

const DEFAULT_MODEL_RANK = [
  /claude.*sonnet/,
  /claude.*opus/,
  /gpt-5(?!.*audio)/,
  /gpt-4o(?!.*audio)/,
  /gemini/,
  /kimi/,
  /glm/,
  /deepseek/,
]

export function pickOpenCodeDefaultModel(models: string[]): string {
  const unique = uniqueModels(models)
  for (const pattern of DEFAULT_MODEL_RANK) {
    const match = unique.find((model) => pattern.test(normalizeModelId(model)))
    if (match) return match
  }
  return unique[0] ?? ''
}

export function buildOpenCodeModelEntry(model: string): OpenCodeModelEntry {
  const vision = modelSupportsVision(model)
  return {
    name: model,
    limit: getModelLimit(model),
    capabilities: {
      tools: true,
      input: vision ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
  }
}

export type OpenCodeConfigParts = {
  providerId: string
  provider: Record<string, unknown>
  /** Provider plus root model / small_model; CC Switch rejects a wrapped `{ provider }` document. */
  settings: Record<string, unknown>
  config: Record<string, unknown>
}

export function toOpenCodeAuthProviderId(input: OpenCodeConfigInput): string {
  return toOpenCodeProviderId(input.providerId || input.providerName)
}

export const OPENCODE_AUTH_JSON_PATH_UNIX = '~/.local/share/opencode/auth.json'
export const OPENCODE_AUTH_JSON_PATH_WINDOWS =
  '%userprofile%\\.local\\share\\opencode\\auth.json'

export function openCodeAuthJsonPath(platform: 'unix' | 'windows'): string {
  return platform === 'unix'
    ? OPENCODE_AUTH_JSON_PATH_UNIX
    : OPENCODE_AUTH_JSON_PATH_WINDOWS
}

export function buildOpenCodeAuthJson(input: OpenCodeConfigInput): string {
  const providerId = toOpenCodeAuthProviderId(input)
  return JSON.stringify(
    {
      [providerId]: {
        type: 'api',
        key: input.apiKey,
      },
    },
    null,
    2
  )
}

export function buildOpenCodeConfigParts(
  input: OpenCodeConfigInput
): OpenCodeConfigParts {
  const providerId = toOpenCodeProviderId(
    input.providerId || input.providerName
  )
  const models = uniqueModels([
    input.defaultModel || '',
    ...input.models,
    input.smallModel || '',
  ])
  const modelEntries: Record<string, OpenCodeModelEntry> = {}
  for (const model of models) {
    modelEntries[model] = buildOpenCodeModelEntry(model)
  }
  const options = {
    baseURL: normalizeCompatBaseUrl(input.baseUrl),
    setCacheKey: true,
  }
  const provider: Record<string, unknown> = {
    npm: OPENCODE_NPM_OPENAI_COMPATIBLE,
    name: input.providerName || providerId,
    options,
    models: modelEntries,
  }
  const defaultModel = (input.defaultModel || models[0] || '').trim()
  const smallModel = (input.smallModel || '').trim()
  const model = defaultModel ? `${providerId}/${defaultModel}` : ''
  const small_model = smallModel ? `${providerId}/${smallModel}` : ''

  const settings: Record<string, unknown> = {
    ...provider,
    options: {
      ...options,
      apiKey: input.apiKey,
    },
  }
  const config: Record<string, unknown> = {
    $schema: OPENCODE_CONFIG_SCHEMA,
    provider: { [providerId]: provider },
  }
  if (model) {
    settings.model = model
    config.model = model
  }
  if (small_model) {
    settings.small_model = small_model
    config.small_model = small_model
  }
  return { providerId, provider, settings, config }
}

export function buildOpenCodeProviderSettings(
  input: OpenCodeConfigInput
): Record<string, unknown> {
  return buildOpenCodeConfigParts(input).settings
}

export function buildOpenCodeConfig(input: OpenCodeConfigInput): string {
  return JSON.stringify(buildOpenCodeConfigParts(input).config, null, 2)
}
