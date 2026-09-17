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
import { normalizeModelId } from './model-limits'

export function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const model of models) {
    const id = model.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function normalizeCompatBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (/\/v1$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

export function modelSupportsVision(model: string): boolean {
  const id = normalizeModelId(model)
  if (!id) return false
  if (/text-only|tts|whisper|embed|rerank/.test(id)) return false
  return /claude|gpt-4o|gpt-4\.1|gpt-5|gemini|grok|qwen.*vl|vision|pixtral|llama-4|gpt-4-turbo/.test(
    id
  )
}

export function modelSupportsReasoning(model: string): boolean {
  const id = normalizeModelId(model)
  if (!id) return false
  return /claude|gpt-5|(^|[/:-])o[1-4]|gemini|grok|qwq|\br1\b|deepseek-v4|kimi|glm-5/.test(
    id
  )
}
