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
import { matchModelLimit, normalizeModelId } from './model-limits'
import {
  modelSupportsReasoning,
  normalizeCompatBaseUrl,
  uniqueModels,
} from './model-meta'

export const GROK_DEFAULT_REASONING_EFFORT = 'medium'

/** Grok CLI built-in effort ids. */
export const GROK_DEFAULT_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const

/** GPT-5 / o-series extra levels New API can relay as reasoning_effort. */
export const GROK_GPT_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'ultra',
] as const

export type GrokPlatform = 'unix' | 'windows'

export type GrokConfigInput = {
  baseUrl: string
  defaultModel: string
  models: string[]
}

export type GrokModelOverride = {
  id: string
  context_window: number
  max_completion_tokens: number
  efforts?: string[]
}

function isGptReasoningFamily(model: string): boolean {
  const id = normalizeModelId(model)
  if (!id) return false
  if (/gpt-4o/.test(id)) return false
  return /gpt-5|gpt-6|(^|[/:-])o[1-4](-|$)/.test(id)
}

export function grokEffortsForModel(model: string): string[] | undefined {
  if (isGptReasoningFamily(model)) return [...GROK_GPT_EFFORTS]
  if (modelSupportsReasoning(model)) return [...GROK_DEFAULT_EFFORTS]
  return undefined
}

export function resolveGrokModel(model: string): GrokModelOverride | null {
  const id = model.trim()
  if (!id) return null

  const catalog = matchModelLimit(id)
  if (!catalog) return null

  return {
    id,
    context_window: catalog.context,
    max_completion_tokens: catalog.output,
    efforts: grokEffortsForModel(id),
  }
}

export function resolveGrokModels(input: GrokConfigInput): GrokModelOverride[] {
  const out: GrokModelOverride[] = []
  for (const model of uniqueModels([input.defaultModel, ...input.models])) {
    const resolved = resolveGrokModel(model)
    if (resolved) out.push(resolved)
  }
  return out
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function tomlTableKey(id: string): string {
  return tomlString(id)
}

function sameEfforts(actual: string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

function formatModelBlock(model: GrokModelOverride): string {
  const lines = [
    `[model.${tomlTableKey(model.id)}]`,
    `context_window = ${model.context_window}`,
    `max_completion_tokens = ${model.max_completion_tokens}`,
  ]
  if (model.efforts && model.efforts.length > 0) {
    lines.push('supports_reasoning_effort = true')
    if (!sameEfforts(model.efforts, GROK_DEFAULT_EFFORTS)) {
      const items = model.efforts
        .map((value) => `{ value = ${tomlString(value)} }`)
        .join(', ')
      lines.push(`reasoning_efforts = [${items}]`)
    }
  }
  return lines.join('\n')
}

export function buildGrokEnvVars(
  apiKey: string,
  baseUrl: string,
  platform: GrokPlatform
): string {
  const endpoint = normalizeCompatBaseUrl(baseUrl)
  if (platform === 'windows') {
    return [
      `set XAI_API_KEY="${apiKey}"`,
      `set GROK_XAI_API_BASE_URL="${endpoint}"`,
    ].join('\n')
  }
  return [
    `export XAI_API_KEY="${apiKey}"`,
    `export GROK_XAI_API_BASE_URL="${endpoint}"`,
  ].join('\n')
}

export function buildGrokConfigToml(input: GrokConfigInput): string {
  const endpoint = normalizeCompatBaseUrl(input.baseUrl)
  const models = resolveGrokModels(input)
  const requestedDefault = input.defaultModel.trim()
  const defaultModel =
    models.find((model) => model.id === requestedDefault)?.id ?? models[0]?.id

  const parts = [
    '[endpoints]',
    `xai_api_base_url = ${tomlString(endpoint)}`,
    `models_base_url = ${tomlString(endpoint)}`,
    '',
    '[models]',
  ]
  if (defaultModel) {
    parts.push(`default = ${tomlString(defaultModel)}`)
  }
  parts.push(
    `default_reasoning_effort = ${tomlString(GROK_DEFAULT_REASONING_EFFORT)}`
  )

  for (const model of models) {
    parts.push('', formatModelBlock(model))
  }

  return parts.join('\n') + '\n'
}

export function grokConfigTomlPath(platform: GrokPlatform): string {
  return platform === 'unix'
    ? '~/.grok/config.toml'
    : '%userprofile%\\.grok\\config.toml'
}
