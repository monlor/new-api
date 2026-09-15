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
import { QUOTA_TYPE_VALUES } from '@/features/pricing/constants'
import {
  getDynamicPricingTiers,
  isDynamicPricingModel,
} from '@/features/pricing/lib/dynamic-price'
import { getMinEffectiveRatio } from '@/features/pricing/lib/price'
import type { PricingModel } from '@/features/pricing/types'

/** Classic new-api convention: ratio 1 ≡ $2 / 1M input tokens. */
const BASE_PRICE_USD_PER_MILLION_TOKENS = 2

export const AVG_PROMPT_TOKENS_PER_CALL = 1000
export const AVG_COMPLETION_TOKENS_PER_CALL = 500

type EffectiveModelPricing = {
  modelRatio: number
  completionRatio: number
  effectiveRatio: number
}

function getSubscriptionEffectiveRatio(model: PricingModel): number {
  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  return getMinEffectiveRatio(
    enableGroups,
    model.group_ratio || {},
    model.group_channel_ratio_min_subscription ?? model.group_channel_ratio_min
  )
}

function getEffectiveModelPricing(
  model: PricingModel
): EffectiveModelPricing | undefined {
  const effectiveRatio = getSubscriptionEffectiveRatio(model)
  if (!Number.isFinite(effectiveRatio) || effectiveRatio <= 0) return undefined

  if (isDynamicPricingModel(model)) {
    const tier = getDynamicPricingTiers(model)[0]
    const inputPrice = Number(tier?.inputPrice) || 0
    if (!(inputPrice > 0)) return undefined
    const outputPrice = Number(tier?.outputPrice) || 0
    return {
      modelRatio: inputPrice / BASE_PRICE_USD_PER_MILLION_TOKENS,
      completionRatio: outputPrice > 0 ? outputPrice / inputPrice : 1,
      effectiveRatio,
    }
  }

  const modelRatio = model.model_ratio
  if (!modelRatio || modelRatio <= 0) return undefined
  return {
    modelRatio,
    completionRatio: model.completion_ratio || 1,
    effectiveRatio,
  }
}

/**
 * Official USD value of `quota`: `quota / quotaPerUnit / effectiveRatio`.
 * `modelRatio` cancels (tokens = quota / (modelRatio * effectiveRatio)).
 */
export function calculateModelUsdValue(
  quota: number,
  model: PricingModel,
  quotaPerUnit: number
): number | undefined {
  if (!(quota > 0) || !(quotaPerUnit > 0)) return undefined
  const pricing = getEffectiveModelPricing(model)
  if (!pricing) return undefined
  return quota / quotaPerUnit / pricing.effectiveRatio
}

export function formatFixedUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function findPricingModel(
  models: PricingModel[],
  modelName: string
): PricingModel | undefined {
  const model = models.find((m) => m.model_name === modelName)
  if (!model || !getEffectiveModelPricing(model)) return undefined
  return model
}

export function estimateModelCallCount(
  quota: number,
  model: PricingModel,
  quotaPerUnit: number
): number | undefined {
  if (!(quota > 0) || !(quotaPerUnit > 0)) return undefined

  const pricing = getEffectiveModelPricing(model)
  if (!pricing) return undefined

  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    const costPerCall =
      (model.model_price ?? 0) * quotaPerUnit * pricing.effectiveRatio
    if (!(costPerCall > 0)) return undefined
    return quota / costPerCall
  }

  const costPerCall =
    (AVG_PROMPT_TOKENS_PER_CALL * pricing.modelRatio +
      AVG_COMPLETION_TOKENS_PER_CALL *
        pricing.modelRatio *
        pricing.completionRatio) *
    pricing.effectiveRatio
  if (!(costPerCall > 0)) return undefined
  return quota / costPerCall
}

export function formatEstimatedCallCount(
  value: number | null | undefined
): string {
  if (value == null || Number.isNaN(value) || value <= 0) return '-'
  let rounded: number
  if (value < 1000) rounded = Math.round(value)
  else if (value < 10000) rounded = Math.round(value / 10) * 10
  else rounded = Math.round(value / 100) * 100
  if (rounded <= 0) return '-'
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    rounded
  )
}

/** Series key: lowercase prefix before the first `-`. */
export function getModelSeries(modelName: string): string {
  return (modelName || '').trim().toLowerCase().split('-')[0] || ''
}

export function calculateSeriesRawValue(
  quota: number,
  seriesModels: PricingModel[],
  quotaPerUnit: number
): number | undefined {
  if (!(quota > 0) || !(quotaPerUnit > 0)) return undefined

  let best: number | undefined
  for (const model of seriesModels) {
    const value = calculateModelUsdValue(quota, model, quotaPerUnit)
    if (value === undefined || !Number.isFinite(value) || value <= 0) continue
    if (best === undefined || value > best) best = value
  }
  return best
}
