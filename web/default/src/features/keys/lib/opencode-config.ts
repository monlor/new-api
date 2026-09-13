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

// OpenCode custom-provider defaults from official docs:
// https://opencode.ai/docs/providers/ and https://opencode.ai/docs/models/
// Unknown catalog models assume 200k context / 32k output.
export const OPENCODE_DEFAULT_CONTEXT = 200_000
export const OPENCODE_DEFAULT_OUTPUT = 32_000
export const OPENCODE_NPM_OPENAI_COMPATIBLE = '@ai-sdk/openai-compatible'
export const OPENCODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json'

export type OpenCodeModelLimit = {
  context: number
  output: number
}

export type OpenCodeModelEntry = {
  name: string
  limit: OpenCodeModelLimit
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

type LimitRule = {
  test: (id: string) => boolean
  limit: OpenCodeModelLimit
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/_/g, '-')
}

function modelLeaf(id: string): string {
  const slash = id.lastIndexOf('/')
  const colon = id.lastIndexOf(':')
  const sep = Math.max(slash, colon)
  return sep >= 0 ? id.slice(sep + 1) : id
}

function parseLimitFromId(id: string): OpenCodeModelLimit | null {
  const match = modelLeaf(id).match(/(?:^|[-_])(\d+(?:\.\d+)?)(k|m)(?:[-_]|$)/i)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = match[2].toLowerCase()
  const context = Math.round(n * (unit === 'm' ? 1_000_000 : 1_000))
  if (context < 1_000) return null
  return {
    context,
    output: Math.min(OPENCODE_DEFAULT_OUTPUT, context),
  }
}

// More specific rules first. Context/output follow public model cards and
// OpenCode provider examples (limit.context / limit.output).
const LIMIT_RULES: LimitRule[] = [
  {
    test: (id) => /claude.*haiku/.test(id),
    limit: { context: 200_000, output: 64_000 },
  },
  {
    test: (id) => /claude.*sonnet/.test(id),
    limit: { context: 200_000, output: 64_000 },
  },
  {
    test: (id) => /claude.*opus/.test(id),
    limit: { context: 200_000, output: 32_000 },
  },
  {
    test: (id) => /claude/.test(id),
    limit: { context: 200_000, output: 32_000 },
  },
  {
    test: (id) => /gpt-5\.[4-9]/.test(id),
    limit: { context: 1_050_000, output: 128_000 },
  },
  {
    test: (id) => /gpt-5/.test(id) || /(^|[-/:])codex/.test(id) || /codex$/.test(id),
    limit: { context: 400_000, output: 128_000 },
  },
  {
    test: (id) => /gpt-4\.1/.test(id),
    limit: { context: 1_047_576, output: 32_768 },
  },
  {
    test: (id) => /gpt-4o/.test(id),
    limit: { context: 128_000, output: 16_384 },
  },
  {
    test: (id) => /gpt-4-turbo|gpt-4\.0|gpt-4-0125|gpt-4-1106/.test(id),
    limit: { context: 128_000, output: 4_096 },
  },
  {
    test: (id) => /(^|[/:-])o[1-4](-|$)|(^|[/:-])o3/.test(id),
    limit: { context: 200_000, output: 100_000 },
  },
  {
    test: (id) => /gemini/.test(id),
    limit: { context: 1_048_576, output: 65_536 },
  },
  {
    test: (id) => /deepseek.*v4|deepseek-v4/.test(id),
    limit: { context: 163_840, output: 32_000 },
  },
  {
    test: (id) => /deepseek/.test(id),
    limit: { context: 128_000, output: 8_192 },
  },
  {
    test: (id) => /glm-5|glm-4\.[5-9]/.test(id),
    limit: { context: 202_752, output: 16_384 },
  },
  {
    test: (id) => /glm/.test(id),
    limit: { context: 128_000, output: 4_096 },
  },
  {
    test: (id) => /kimi-k2\.5|kimi-k2-5|k2\.5/.test(id),
    limit: { context: 256_000, output: 32_768 },
  },
  {
    test: (id) => /kimi|moonshot/.test(id),
    limit: { context: 128_000, output: 32_768 },
  },
  {
    test: (id) => /qwen.*long|qwen-long/.test(id),
    limit: { context: 1_000_000, output: 8_192 },
  },
  {
    test: (id) => /qwen3|qwen2\.5|qwen-2\.5/.test(id),
    limit: { context: 128_000, output: 16_384 },
  },
  {
    test: (id) => /qwen/.test(id),
    limit: { context: 32_768, output: 8_192 },
  },
  {
    test: (id) => /grok/.test(id),
    limit: { context: 256_000, output: 32_768 },
  },
  {
    test: (id) => /minimax|abab/.test(id),
    limit: { context: 204_800, output: 32_768 },
  },
  {
    test: (id) => /mistral|codestral|devstral|pixtral/.test(id),
    limit: { context: 128_000, output: 8_192 },
  },
  {
    test: (id) => /llama-4|llama4/.test(id),
    limit: { context: 1_000_000, output: 16_384 },
  },
  {
    test: (id) => /llama-3|llama3/.test(id),
    limit: { context: 128_000, output: 4_096 },
  },
]

export function getOpenCodeModelLimit(model: string): OpenCodeModelLimit {
  const id = normalizeModelId(model)
  if (!id) {
    return { context: OPENCODE_DEFAULT_CONTEXT, output: OPENCODE_DEFAULT_OUTPUT }
  }

  const fromName = parseLimitFromId(id)
  if (fromName) return fromName

  for (const rule of LIMIT_RULES) {
    if (rule.test(id) || rule.test(modelLeaf(id))) {
      return { ...rule.limit }
    }
  }

  return { context: OPENCODE_DEFAULT_CONTEXT, output: OPENCODE_DEFAULT_OUTPUT }
}

export function modelSupportsVision(model: string): boolean {
  const id = normalizeModelId(model)
  if (!id) return false
  if (/text-only|tts|whisper|embed|rerank/.test(id)) return false
  return /claude|gpt-4o|gpt-4\.1|gpt-5|gemini|grok|qwen.*vl|vision|pixtral|llama-4|gpt-4-turbo/.test(
    id
  )
}

export function toOpenCodeProviderId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'newapi'
}

export function normalizeOpenCodeBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (/\/v1$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

function uniqueModels(models: string[], defaultModel: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const model of [defaultModel, ...models]) {
    const id = model.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
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
  const unique = uniqueModels(models, '')
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
  const unique = uniqueModels(models, '')
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
    limit: getOpenCodeModelLimit(model),
    capabilities: {
      tools: true,
      input: vision ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
  }
}

export function buildOpenCodeConfig(input: OpenCodeConfigInput): string {
  const providerId = toOpenCodeProviderId(input.providerId || input.providerName)
  const baseURL = normalizeOpenCodeBaseUrl(input.baseUrl)
  const models = uniqueModels(input.models, input.defaultModel)
  const defaultModel = (input.defaultModel || models[0] || '').trim()
  const modelEntries: Record<string, OpenCodeModelEntry> = {}
  for (const model of models) {
    modelEntries[model] = buildOpenCodeModelEntry(model)
  }

  const config: Record<string, unknown> = {
    $schema: OPENCODE_CONFIG_SCHEMA,
    provider: {
      [providerId]: {
        npm: OPENCODE_NPM_OPENAI_COMPATIBLE,
        name: input.providerName || providerId,
        options: {
          baseURL,
          apiKey: input.apiKey,
          setCacheKey: true,
        },
        models: modelEntries,
      },
    },
  }

  if (defaultModel) {
    config.model = `${providerId}/${defaultModel}`
  }

  const smallModel = (input.smallModel || '').trim()
  if (smallModel) {
    config.small_model = `${providerId}/${smallModel}`
  }

  return JSON.stringify(config, null, 2)
}

export function ensureOpenCodeModelFields(
  configJson: string,
  input: {
    providerName: string
    defaultModel?: string
    smallModel?: string
  }
): string {
  const parsed = JSON.parse(configJson) as Record<string, unknown>
  const providerId = toOpenCodeProviderId(input.providerName)
  const defaultModel = (input.defaultModel || '').trim()
  const smallModel = (input.smallModel || '').trim()
  if (defaultModel) parsed.model = `${providerId}/${defaultModel}`
  else delete parsed.model
  if (smallModel) parsed.small_model = `${providerId}/${smallModel}`
  else delete parsed.small_model
  return JSON.stringify(parsed, null, 2)
}

export function buildOpenCodeProviderSettings(input: {
  apiKey: string
  baseUrl: string
  providerName: string
  models: string[]
  defaultModel?: string
  smallModel?: string
}): Record<string, unknown> {
  // Match CC Switch OpenCodeProviderConfig / official opencode.json provider
  // entries: npm, name, options.{baseURL,apiKey,setCacheKey}, models[id].{name,limit}.
  const modelEntries: Record<string, { name: string; limit: OpenCodeModelLimit }> =
    {}
  for (const model of uniqueModels(input.models, '')) {
    modelEntries[model] = {
      name: model,
      limit: getOpenCodeModelLimit(model),
    }
  }
  // Official OpenCode config puts `model` / `small_model` at the opencode.json
  // root as `provider_id/model_id`, not inside provider.options.
  // https://opencode.ai/docs/config/
  const providerId = toOpenCodeProviderId(input.providerName)
  const defaultModel = (input.defaultModel || '').trim()
  const smallModel = (input.smallModel || '').trim()
  const settings: Record<string, unknown> = {
    npm: OPENCODE_NPM_OPENAI_COMPATIBLE,
    name: input.providerName,
    options: {
      baseURL: normalizeOpenCodeBaseUrl(input.baseUrl),
      apiKey: input.apiKey,
      setCacheKey: true,
    },
    models: modelEntries,
  }
  if (defaultModel) settings.model = `${providerId}/${defaultModel}`
  if (smallModel) settings.small_model = `${providerId}/${smallModel}`
  return settings
}
