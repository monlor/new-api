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
import dayjs from '@/lib/dayjs'
import type { SubscriptionPlan } from '../types'

export function formatDuration(
  plan: Partial<SubscriptionPlan>,
  t: TFunction
): string {
  const unit = plan?.duration_unit || 'month'
  const value = plan?.duration_value || 1
  const unitLabels: Record<string, string> = {
    year: t('years'),
    month: t('months'),
    day: t('days'),
    hour: t('hours'),
    custom: t('Custom (seconds)'),
  }
  if (unit === 'custom') {
    const seconds = plan?.custom_seconds || 0
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('days')}`
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('hours')}`
    return `${seconds} ${t('seconds')}`
  }
  return `${value} ${unitLabels[unit] || unit}`
}

export function formatResetPeriod(
  plan: Partial<SubscriptionPlan>,
  t: TFunction
): string {
  const period = plan?.quota_reset_period || 'never'
  if (period === 'daily') return t('Daily')
  if (period === 'weekly') return t('Weekly')
  if (period === 'monthly') return t('Monthly')
  if (period === 'custom') {
    const seconds = Number(plan?.quota_reset_custom_seconds || 0)
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('days')}`
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('hours')}`
    if (seconds >= 60) return `${Math.floor(seconds / 60)} ${t('minutes')}`
    return `${seconds} ${t('seconds')}`
  }
  return t('No Reset')
}

export function formatTimestamp(ts: number): string {
  if (!ts) return '-'
  return dayjs(ts * 1000).format('YYYY-MM-DD HH:mm:ss')
}

/** Whether the plan has a repeating quota reset (not 'never'). */
export function planHasReset(plan: Partial<SubscriptionPlan>): boolean {
  const period = plan?.quota_reset_period || 'never'
  return period !== 'never'
}

/**
 * Estimate the number of reset periods that fit within the subscription duration.
 * Returns null when reset is 'never' or data is insufficient.
 */
export function calcPeriodCount(plan: Partial<SubscriptionPlan>): number | null {
  if (!planHasReset(plan)) return null

  const dval = plan?.duration_value || 1
  let durationSeconds: number
  switch (plan?.duration_unit) {
    case 'year':   durationSeconds = dval * 365 * 86400; break
    case 'month':  durationSeconds = dval * 30 * 86400; break
    case 'day':    durationSeconds = dval * 86400; break
    case 'hour':   durationSeconds = dval * 3600; break
    case 'custom': durationSeconds = Number(plan?.custom_seconds || 0); break
    default: return null
  }

  let resetSeconds: number
  switch (plan?.quota_reset_period) {
    case 'daily':   resetSeconds = 86400; break
    case 'weekly':  resetSeconds = 7 * 86400; break
    case 'monthly': resetSeconds = 30 * 86400; break
    case 'custom':  resetSeconds = Number(plan?.quota_reset_custom_seconds || 0); break
    default: return null
  }

  if (!durationSeconds || !resetSeconds) return null
  const count = Math.floor(durationSeconds / resetSeconds)
  return count > 0 ? count : null
}

/**
 * Estimate total quota across all reset periods for a plan.
 * Returns null when reset is 'never', perPeriod is 0 (unlimited), or period count can't be calculated.
 */
export function calcEstimatedTotal(plan: Partial<SubscriptionPlan>): number | null {
  const perPeriod = Number(plan?.total_amount || 0)
  if (perPeriod <= 0) return null
  const periods = calcPeriodCount(plan)
  if (!periods) return null
  return perPeriod * periods
}
