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
export const CONTENT_REVIEW_MODES = ['off', 'async', 'block'] as const
export type ContentReviewMode = (typeof CONTENT_REVIEW_MODES)[number]

export function resolveContentReviewMode(
  mode: string | undefined,
  enabled: boolean,
  blockEnabled: boolean
): ContentReviewMode {
  const normalized = String(mode ?? '').toLowerCase()
  if (
    normalized === 'off' ||
    normalized === 'async' ||
    normalized === 'block'
  ) {
    return normalized
  }
  if (enabled) {
    return blockEnabled ? 'block' : 'async'
  }
  return 'off'
}

export function resolveContentReviewPrompt(
  prompt: string | undefined,
  builtinPrompt: string | undefined
): string {
  if (String(prompt ?? '').trim() !== '') {
    return String(prompt ?? '')
  }
  return String(builtinPrompt ?? '')
}
