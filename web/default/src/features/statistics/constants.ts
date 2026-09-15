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
import type { StatisticsPeriodId } from './types'

/** The two top-level tabs of the statistics page. */
export const STATISTICS_TABS = ['usage', 'revenue'] as const
export type StatisticsTabId = (typeof STATISTICS_TABS)[number]
export const STATISTICS_DEFAULT_TAB: StatisticsTabId = 'usage'

export function isStatisticsTabId(value: unknown): value is StatisticsTabId {
  return (
    typeof value === 'string' &&
    (STATISTICS_TABS as readonly string[]).includes(value)
  )
}

/** Period presets. `labelKey` is the flat i18n key (English source text). */
export const STATISTICS_PERIOD_OPTIONS: {
  id: StatisticsPeriodId
  labelKey: string
}[] = [
  { id: 'today', labelKey: 'Today' },
  { id: '7d', labelKey: 'Last 7 days' },
  { id: '30d', labelKey: 'Last 30 days' },
  { id: 'custom', labelKey: 'Custom' },
]

export const STATISTICS_DEFAULT_PERIOD: StatisticsPeriodId = '7d'

/** Number of sparkline buckets rendered in the user table trend column. */
export const USER_TREND_SPARKLINE_BUCKETS = 12

/**
 * Payment providers selectable in the revenue filter. `balance` is excluded
 * on purpose: it is an internal credit deduction, not real revenue.
 */
export const REVENUE_PROVIDER_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'All Payment Methods' },
  { value: 'stripe', labelKey: 'Stripe' },
  { value: 'creem', labelKey: 'Creem' },
  { value: 'waffo', labelKey: 'Waffo' },
  { value: 'waffo_pancake', labelKey: 'Waffo Pancake' },
  { value: 'epay', labelKey: 'EPay' },
]

/** Stable chart colours, aligned with the theme chart palette. */
export const REVENUE_PROVIDER_COLORS: Record<string, string> = {
  stripe: 'var(--chart-1)',
  creem: 'var(--chart-2)',
  waffo: 'var(--chart-3)',
  waffo_pancake: 'var(--chart-4)',
  epay: 'var(--chart-5)',
}

export const REVENUE_FALLBACK_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]
