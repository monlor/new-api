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
import { formatFixedUsd } from '@/features/subscriptions/lib/model-value'

/**
 * Raw official USD value — deliberately NOT language-converted (Rule 11's
 * "original/official value" exception), matching how the subscription page
 * renders its series raw value. Unavailable values render as an em dash, the
 * placeholder used across the statistics tables.
 */
export function formatOriginalValueUsd(
  value: number | null | undefined
): string {
  if (value == null || Number.isNaN(value)) return '—'
  return formatFixedUsd(value)
}
