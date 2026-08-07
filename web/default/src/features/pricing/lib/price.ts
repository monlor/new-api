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
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { QUOTA_TYPE_VALUES, TOKEN_UNIT_DIVISORS } from '../constants'
import type {
  EffectiveRatioRange,
  PriceDisplayMode,
  PricingModel,
  TokenUnit,
  PriceType,
} from '../types'

// ----------------------------------------------------------------------------
// Price Calculation Utilities
// ----------------------------------------------------------------------------

/**
 * Strip trailing zeros from formatted price string while preserving currency symbols
 */
export function stripTrailingZeros(formatted: string): string {
  // Match currency symbol at start, number, and potential 'k' suffix
  const match = formatted.match(/^([^\d-]*)([-\d,]+\.?\d*)(k?)$/)
  if (!match) return formatted

  const [, symbol, number, suffix] = match

  // Remove commas for processing
  const cleanNumber = number.replace(/,/g, '')

  // Convert to number and back to remove trailing zeros
  const parsed = parseFloat(cleanNumber)
  if (isNaN(parsed)) return formatted

  // Convert to string, which automatically removes trailing zeros
  let result = parsed.toString()

  // If the result is in scientific notation, format it properly
  if (result.includes('e')) {
    result = parsed.toFixed(20).replace(/\.?0+$/, '')
  }

  return `${symbol}${result}${suffix}`
}

/**
 * Find minimum effective ratio (group ratio × min channel ratio) from enabled groups
 */
export function getMinEffectiveRatio(
  enableGroups: string[],
  groupRatio: Record<string, number>,
  groupChannelRatioMin?: Record<string, number>
): number {
  if (enableGroups.length === 0) return 1

  let minRatio = Number.POSITIVE_INFINITY

  for (const group of enableGroups) {
    const gr = groupRatio[group]
    if (gr === undefined) continue
    const cr = groupChannelRatioMin?.[group] ?? 1
    const effective = gr * cr
    if (effective < minRatio) {
      minRatio = effective
    }
  }

  return minRatio === Number.POSITIVE_INFINITY ? 1 : minRatio
}

/** Resolve the complete group x channel multiplier range for one group. */
export function getEffectiveRatioRange(
  group: string,
  groupRatio: Record<string, number>,
  channelRatioMin?: Record<string, number>,
  channelRatioMax?: Record<string, number>
): EffectiveRatioRange {
  const groupMultiplier = groupRatio[group] ?? 1
  const channelMin = channelRatioMin?.[group] ?? 1
  const channelMax = channelRatioMax?.[group] ?? channelMin
  const first = groupMultiplier * channelMin
  const second = groupMultiplier * channelMax

  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  }
}

/**
 * Calculate token price in USD.
 *
 * Returns NaN when the required ratio field is missing/null so callers can
 * skip rendering that price type.
 */
export function calculateTokenPriceUSD(
  model: PricingModel,
  type: PriceType,
  ratio: number
): number {
  const base = model.model_ratio * 2 * ratio

  switch (type) {
    case 'input':
      return base
    case 'output':
      return base * model.completion_ratio
    case 'cache':
      return hasRatio(model.cache_ratio)
        ? base * Number(model.cache_ratio)
        : NaN
    case 'create_cache':
      return hasRatio(model.create_cache_ratio)
        ? base * Number(model.create_cache_ratio)
        : NaN
    case 'image':
      return hasRatio(model.image_ratio)
        ? base * Number(model.image_ratio)
        : NaN
    case 'audio_input':
      return hasRatio(model.audio_ratio)
        ? base * Number(model.audio_ratio)
        : NaN
    case 'audio_output':
      return hasRatio(model.audio_ratio) &&
        hasRatio(model.audio_completion_ratio)
        ? base *
            Number(model.audio_ratio) *
            Number(model.audio_completion_ratio)
        : NaN
  }
}

export function calculateRequestPriceUSD(
  model: PricingModel,
  ratio: number
): number {
  return (model.model_price ?? 0) * ratio
}

function hasRatio(value: number | null | undefined): boolean {
  return value !== undefined && value !== null && Number.isFinite(Number(value))
}

function formatUSDPrice(price: number, digitsSmall = 6): string {
  return formatBillingCurrencyFromUSD(price, {
    digitsLarge: 4,
    digitsSmall,
    abbreviate: false,
  })
}

function formatUSDRange(
  range: EffectiveRatioRange,
  getPrice: (ratio: number) => number,
  digitsSmall = 6
): string {
  const lo = formatUSDPrice(getPrice(range.min), digitsSmall)
  if (range.min === range.max) return lo
  return `${lo} ~ ${formatUSDPrice(getPrice(range.max), digitsSmall)}`
}

/**
 * Format token-based price for display
 */
export function formatPrice(
  model: PricingModel,
  type: PriceType,
  tokenUnit: TokenUnit
): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const groupRatio = model.group_ratio || {}
  const minRatio = getMinEffectiveRatio(
    enableGroups,
    groupRatio,
    model.group_channel_ratio_min
  )

  const priceInUSD =
    calculateTokenPriceUSD(model, type, minRatio) /
    TOKEN_UNIT_DIVISORS[tokenUnit]
  return formatUSDPrice(priceInUSD)
}

/**
 * Format price for a specific group (token-based), returns range string when channels differ
 */
export function formatGroupPrice(
  model: PricingModel,
  group: string,
  type: PriceType,
  tokenUnit: TokenUnit,
  groupRatio: Record<string, number>,
  channelRatioMinOverride?: Record<string, number>,
  channelRatioMaxOverride?: Record<string, number>,
  displayMode: PriceDisplayMode = 'discounted'
): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const ratioMinMap = channelRatioMinOverride ?? model.group_channel_ratio_min
  // When a min override is provided (split-by-billing-type mode), fall back to
  // that same map as the max (single value, no range) rather than the combined
  // model.group_channel_ratio_max which may include channels from other billing types.
  const ratioMaxMap =
    channelRatioMaxOverride ??
    (channelRatioMinOverride !== undefined
      ? channelRatioMinOverride
      : model.group_channel_ratio_max)
  const ratioRange =
    displayMode === 'original'
      ? { min: 1, max: 1 }
      : getEffectiveRatioRange(group, groupRatio, ratioMinMap, ratioMaxMap)

  return formatUSDRange(
    ratioRange,
    (ratio) =>
      calculateTokenPriceUSD(model, type, ratio) /
      TOKEN_UNIT_DIVISORS[tokenUnit]
  )
}

/**
 * Format fixed price for pay-per-request models (with specific group), returns range when channels differ
 */
export function formatFixedPrice(
  model: PricingModel,
  group: string,
  groupRatio: Record<string, number>,
  channelRatioMinOverride?: Record<string, number>,
  channelRatioMaxOverride?: Record<string, number>,
  displayMode: PriceDisplayMode = 'discounted'
): string {
  if (model.quota_type !== QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const ratioMinMap = channelRatioMinOverride ?? model.group_channel_ratio_min
  const ratioMaxMap =
    channelRatioMaxOverride ??
    (channelRatioMinOverride !== undefined
      ? channelRatioMinOverride
      : model.group_channel_ratio_max)
  const ratioRange =
    displayMode === 'original'
      ? { min: 1, max: 1 }
      : getEffectiveRatioRange(group, groupRatio, ratioMinMap, ratioMaxMap)

  return formatUSDRange(
    ratioRange,
    (ratio) => calculateRequestPriceUSD(model, ratio),
    4
  )
}

/**
 * Format fixed price for pay-per-request models (minimum price from all groups)
 */
export function formatRequestPrice(model: PricingModel): string {
  if (model.quota_type !== QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const groupRatio = model.group_ratio || {}
  const minRatio = getMinEffectiveRatio(
    enableGroups,
    groupRatio,
    model.group_channel_ratio_min
  )

  return formatUSDPrice(calculateRequestPriceUSD(model, minRatio), 4)
}

/**
 * Compute the effective ratio shown on a model in the marketplace.
 *
 * Combines group ratio with the minimum channel ratio, taking the minimum
 * across all enabled groups. This is the same "best (lowest) effective ratio"
 * used by the price columns, so the badge stays consistent with displayed
 * prices. Applies to all billing types (token / per-request / dynamic), since
 * both ratios multiply into every billing path.
 */
export function getEffectiveRatio(model: PricingModel): number {
  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const groupRatio = model.group_ratio || {}
  return getMinEffectiveRatio(
    enableGroups,
    groupRatio,
    model.group_channel_ratio_min
  )
}

/**
 * Format a ratio as a compact label, e.g. 0.5 -> "x0.5", 2 -> "x2".
 * Integers render bare; decimals are kept to at most 2 places, trailing zeros
 * dropped.
 */
export function formatRatioLabel(ratio: number): string {
  const formatted = Number.isInteger(ratio)
    ? ratio.toString()
    : ratio.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `x${formatted}`
}

export function formatEffectiveRatioRange(range: EffectiveRatioRange): string {
  const min = formatRatioLabel(range.min)
  if (range.min === range.max) return min
  return `${min} ~ ${formatRatioLabel(range.max)}`
}
