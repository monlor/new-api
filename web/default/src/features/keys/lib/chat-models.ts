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

const CHAT_ENDPOINTS = new Set([
  'openai',
  'openai-response',
  'openai-response-compact',
  'anthropic',
  'gemini',
])

const NON_CHAT_ENDPOINTS = new Set([
  'image-generation',
  'openai-video',
  'embeddings',
  'jina-rerank',
])

const NON_CHAT_NAME_RE =
  /embed|rerank|moderation|whisper|\btts\b|tts-|realtime|audio|voice|dall-?e|imagen|flux|midjourney|stable-?diffusion|sdxl|sora|\bveo\b|kling|pika|jimeng|cogview|cogvideo|hunyuan[-_]?video|\bwan[-_.]|gpt-image|seedream|vidu|runway|luma|hailuo|image-gen/i

export function isChatModel(name: string, endpoints?: string[]): boolean {
  const id = name.trim()
  if (!id) return false
  if (endpoints && endpoints.length > 0) {
    const onlyNonChat = endpoints.every((endpoint) =>
      NON_CHAT_ENDPOINTS.has(endpoint)
    )
    if (onlyNonChat) return false
    const hasChat = endpoints.some((endpoint) => CHAT_ENDPOINTS.has(endpoint))
    if (hasChat) return !NON_CHAT_NAME_RE.test(id)
    if (endpoints.some((endpoint) => NON_CHAT_ENDPOINTS.has(endpoint))) {
      return false
    }
  }
  return !NON_CHAT_NAME_RE.test(id)
}

export function filterChatModels(
  names: string[],
  endpointMap?: Record<string, string[]>
): string[] {
  return names.filter((name) => isChatModel(name, endpointMap?.[name]))
}

export function endpointMapFromPricing(
  models?: Array<{
    model_name?: string
    supported_endpoint_types?: string[]
  }>
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const model of models ?? []) {
    if (model.model_name) {
      map[model.model_name] = model.supported_endpoint_types ?? []
    }
  }
  return map
}
