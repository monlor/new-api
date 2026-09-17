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

export type ModelLimit = {
  context: number
  output: number
}

export const DEFAULT_MODEL_CONTEXT = 200_000
export const DEFAULT_MODEL_OUTPUT = 32_000
export const GPT_LONG_CONTEXT = 1_050_000

type LimitRule = {
  test: (id: string) => boolean
  limit: ModelLimit
}

export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/_/g, '-')
}

function modelLeaf(id: string): string {
  const slash = id.lastIndexOf('/')
  const colon = id.lastIndexOf(':')
  const sep = Math.max(slash, colon)
  return sep >= 0 ? id.slice(sep + 1) : id
}

function parseLimitFromId(id: string): ModelLimit | null {
  const match = modelLeaf(id).match(/(?:^|[-_])(\d+(?:\.\d+)?)(k|m)(?:[-_]|$)/i)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = match[2].toLowerCase()
  const context = Math.round(n * (unit === 'm' ? 1_000_000 : 1_000))
  if (context < 1_000) return null
  return {
    context,
    output: Math.min(DEFAULT_MODEL_OUTPUT, context),
  }
}

// More specific rules first. Shared by Grok CLI, OpenCode, Pi, and CC Switch.
const LIMIT_RULES: LimitRule[] = [
  {
    test: (id) => /claude.*haiku/.test(id),
    limit: { context: 200_000, output: 64_000 },
  },
  {
    test: (id) => /claude.*sonnet/.test(id),
    limit: { context: 1_000_000, output: 64_000 },
  },
  {
    test: (id) => /claude.*(opus|fable)/.test(id),
    limit: { context: 1_000_000, output: 32_000 },
  },
  {
    test: (id) => /claude/.test(id),
    limit: { context: 200_000, output: 32_000 },
  },
  {
    test: (id) => /gpt-5\.[4-9]|gpt-5\.\d{2,}|gpt-[6-9]/.test(id),
    limit: { context: GPT_LONG_CONTEXT, output: 128_000 },
  },
  {
    test: (id) =>
      /gpt-5/.test(id) || /(^|[-/:])codex/.test(id) || /codex$/.test(id),
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
    test: (id) => /deepseek/.test(id),
    limit: { context: 1_000_000, output: 32_000 },
  },
  {
    test: (id) => /glm/.test(id),
    limit: { context: 1_000_000, output: 32_000 },
  },
  {
    test: (id) => /grok/.test(id),
    limit: { context: 500_000, output: 32_768 },
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

export function matchModelLimit(model: string): ModelLimit | null {
  const id = normalizeModelId(model)
  if (!id) return null

  const fromName = parseLimitFromId(id)
  if (fromName) return fromName

  for (const rule of LIMIT_RULES) {
    if (rule.test(id) || rule.test(modelLeaf(id))) {
      return { ...rule.limit }
    }
  }

  return null
}

export function getModelLimit(model: string): ModelLimit {
  return (
    matchModelLimit(model) ?? {
      context: DEFAULT_MODEL_CONTEXT,
      output: DEFAULT_MODEL_OUTPUT,
    }
  )
}
