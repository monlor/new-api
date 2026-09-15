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
import type { TFunction } from 'i18next'
import { formatQuota } from '@/lib/format'
import type { PricingModel } from '@/features/pricing/types'
import type { SubscriptionPlan } from '../types'
import { parseDisplayModels } from './display-models'
import {
  calcEstimatedTotal,
  formatDuration,
  formatResetPeriod,
  planHasReset,
} from './format'
import {
  estimateModelCallCount,
  findPricingModel,
  getModelSeries,
  calculateSeriesRawValue,
} from './model-value'

export type PlanCardModelValue = {
  modelName: string
  callCount: number | null
}

export type PlanCardSeriesValue = {
  series: string
  value: number
}

export type PlanCardModel = {
  planId: number
  title: string
  subtitle?: string
  price: number
  durationLabel: string
  isRecommended: boolean
  benefits: string[]
  savePercent: number | null
  reached: boolean
  limit: number
  count: number
  modelValues: PlanCardModelValue[]
  seriesValues: PlanCardSeriesValue[]
}

export function buildPlanCardModel(args: {
  plan: SubscriptionPlan
  purchaseCount: number
  pricingModels: PricingModel[]
  modelsBySeries: Map<string, PricingModel[]>
  quotaPerUnit: number
  t: TFunction
}): PlanCardModel {
  const plan = args.plan
  const t = args.t
  const totalAmount = Number(plan.total_amount || 0)
  const price = Number(plan.price_amount || 0)
  const isRecommended = !!plan.is_recommended
  const limit = Number(plan.max_purchase_per_user || 0)
  const count = args.purchaseCount
  const reached = limit > 0 && count >= limit
  const hasResetPlan = planHasReset(plan)
  const estTotal = calcEstimatedTotal(plan)
  const quotaLabel = hasResetPlan ? t('Period Quota') : t('Total Quota')
  const quotaValue = totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')
  const durationLabel = formatDuration(plan, t)
  const benefits = [
    `${t('Validity Period')}: ${durationLabel}`,
    hasResetPlan ? `${t('Quota Reset')}: ${formatResetPeriod(plan, t)}` : null,
    `${quotaLabel}: ${quotaValue}`,
    hasResetPlan && estTotal
      ? `${t('Total Quota')}: ≈ ${formatQuota(estTotal)}`
      : null,
    limit > 0 ? `${t('Purchase Limit')}: ${limit}` : null,
    plan.upgrade_group ? `${t('Upgrade Group')}: ${plan.upgrade_group}` : null,
  ].filter(Boolean) as string[]

  const effectiveQuota = hasResetPlan && estTotal ? estTotal : totalAmount
  const displayModels = parseDisplayModels(plan.display_models || '')

  const modelValues = displayModels
    .map((modelName) => {
      const model = findPricingModel(args.pricingModels, modelName)
      if (!model) return null
      const callCount =
        effectiveQuota > 0
          ? estimateModelCallCount(effectiveQuota, model, args.quotaPerUnit)
          : null
      if (callCount === undefined) return null
      return { modelName, callCount }
    })
    .filter((v): v is PlanCardModelValue => v !== null)

  const seriesValues =
    effectiveQuota > 0
      ? Array.from(new Set(displayModels.map(getModelSeries).filter(Boolean)))
          .map((series) => {
            const value = calculateSeriesRawValue(
              effectiveQuota,
              args.modelsBySeries.get(series) || [],
              args.quotaPerUnit
            )
            return value === undefined ? null : { series, value }
          })
          .filter((v): v is PlanCardSeriesValue => v !== null)
      : []

  const normalCost =
    effectiveQuota > 0 && args.quotaPerUnit > 0
      ? effectiveQuota / args.quotaPerUnit
      : null
  const rawSavePercent =
    price > 0 && normalCost !== null && normalCost > price
      ? Math.min(99, Math.round((1 - price / normalCost) * 100))
      : null
  const savePercent =
    rawSavePercent !== null &&
    Number.isFinite(rawSavePercent) &&
    rawSavePercent > 0
      ? rawSavePercent
      : null

  return {
    planId: plan.id,
    title: plan.title || t('Subscription Plans'),
    subtitle: plan.subtitle,
    price,
    durationLabel,
    isRecommended,
    benefits,
    savePercent,
    reached,
    limit,
    count,
    modelValues,
    seriesValues,
  }
}
