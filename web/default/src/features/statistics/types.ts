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
// ============================================================================
// Shared
// ============================================================================

/** Unix-second time window shared by every statistics endpoint. */
export interface StatisticsTimeRange {
  start_timestamp: number
  end_timestamp: number
}

/** Period presets offered by the period selector. */
export type StatisticsPeriodId = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

// ============================================================================
// User usage — GET /api/statistics/users
// ============================================================================

export interface UserUsageSummary {
  total_quota: number
  total_count: number
  total_tokens: number
  active_users: number
  quota_growth_pct: number
  count_growth_pct: number
  /** Estimated official USD value of the consumed quota, computed at each
   *  model's cheapest available group × channel ratio (markup excluded).
   *  Omitted/null when the backend cannot compute it. */
  original_value_usd?: number | null
}

export interface UserUsageItem {
  user_id: number
  username: string
  /** Request count. */
  count: number
  /** Consumed quota (raw quota units). */
  quota: number
  /** Estimated official USD value for this user, at each model's cheapest
   *  available group × channel ratio (markup excluded). */
  original_value_usd?: number | null
  token_used: number
  /** Share of the period total quota, 0-100. Denominator is the whole-period
   *  total, so the current page's percentages sum to <= 100. */
  percentage: number
  /**
   * Fixed-length (12) evenly-bucketed quota series, oldest first, used for the
   * inline sparkline. Always an array; empty when the window is invalid.
   * Bucket edges snap to the hour, so the sum can be slightly under `quota` —
   * it is a shape indicator, not an exact figure.
   */
  trend?: number[]
}

export interface UserUsageResponse {
  summary: UserUsageSummary
  items: UserUsageItem[]
  /** Distinct user count for the period (not a row count). */
  total: number
}

// ============================================================================
// User detail dialog — GET /api/statistics/users/detail
// ============================================================================

export interface UserTokenUsageItem {
  token_id: number
  token_name: string
  request_count: number
  quota: number
  /** Estimated official USD value for this key, at each model's cheapest
   *  available group × channel ratio (markup excluded). */
  original_value_usd?: number | null
  token_used: number
  /** Unix seconds; 0 when never used within the window. */
  last_used_at: number
  /**
   * Token status from the `tokens` table. `-1` means the token was
   * soft-deleted and can no longer be resolved; otherwise the usual
   * `model.Token.Status` values (1 = enabled).
   */
  status?: number
}

export interface UserModelUsageItem {
  model_name: string
  request_count: number
  quota: number
  /** Estimated official USD value for this model, at its cheapest available
   *  group × channel ratio (markup excluded). */
  original_value_usd?: number | null
  token_used: number
  /** Share of this user's period quota, 0-100. */
  percentage: number
}

export interface UserUsageDetailSummary {
  count: number
  quota: number
  token_used: number
  original_value_usd?: number | null
}

export interface UserUsageDetailResponse {
  /**
   * Period totals for this user, summed from `models`. Unlike `tokens` this
   * includes calls with no associated API key, so it is the true total.
   */
  summary: UserUsageDetailSummary
  tokens: UserTokenUsageItem[]
  models: UserModelUsageItem[]
}

// ============================================================================
// Revenue — GET /api/statistics/revenue
// ============================================================================

export interface RevenueSummary {
  total_money: number
  order_count: number
  avg_order_value: number
  money_growth_pct: number
}

export interface RevenueTrendPoint {
  /** Bucket start, Unix seconds. */
  bucket: number
  money: number
  count: number
}

export interface RevenueProviderShare {
  provider: string
  money: number
  count: number
  /** Share of total revenue, 0-100. */
  percentage: number
}

export interface RevenueTopUser {
  user_id: number
  username: string
  money: number
  count: number
}

/**
 * A recent successful order as serialized by the backend
 * (`model.RevenueRecentTopUp`). `money` is already normalized to system USD.
 */
export interface RevenueRecentTopUp {
  id: number
  user_id: number
  username: string
  amount: number | string
  money: number
  trade_no: string
  payment_method: string
  payment_provider?: string
  create_time: number
  complete_time: number
  status: string
}

export interface RevenueResponse {
  summary: RevenueSummary
  trend: RevenueTrendPoint[]
  by_provider: RevenueProviderShare[]
  top_users: RevenueTopUser[]
  /** Most recent successful, non-balance orders within the period. */
  recent: RevenueRecentTopUp[]
  /** Bucket width in seconds: 3600 (hourly) or 86400 (daily). */
  bucket_size?: number
}
