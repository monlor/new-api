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
import { api } from '@/lib/api'
import type {
  RevenueResponse,
  StatisticsTimeRange,
  UserTokenUsageResponse,
  UserUsageResponse,
} from './types'

// ============================================================================
// Admin Statistics APIs
//
// All endpoints live under /api/statistics and are guarded by AdminAuth on the
// backend. Time windows use `start_timestamp` / `end_timestamp` (Unix seconds)
// and pagination uses `p` / `page_size`, matching the project-wide convention.
// ============================================================================

/** Paginated per-user usage list plus the period KPI summary. */
export async function getUserStatistics(
  params: StatisticsTimeRange & {
    keyword?: string
    p: number
    page_size: number
  }
) {
  const res = await api.get<{ success: boolean; data: UserUsageResponse }>(
    '/api/statistics/users',
    { params }
  )
  return res.data
}

/**
 * Per-API-key usage for a single user (the inline drill-down).
 * The backend never returns plaintext key material.
 */
export async function getUserTokenStatistics(
  params: StatisticsTimeRange & { user_id: number }
) {
  const res = await api.get<{ success: boolean; data: UserTokenUsageResponse }>(
    '/api/statistics/users/tokens',
    { params }
  )
  return res.data
}

/** Revenue KPIs, trend, provider split, top spenders and recent orders. */
export async function getRevenueStatistics(
  params: StatisticsTimeRange & { provider?: string }
) {
  const res = await api.get<{ success: boolean; data: RevenueResponse }>(
    '/api/statistics/revenue',
    { params }
  )
  return res.data
}
