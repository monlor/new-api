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
import type { UserSubscription } from '../types'

export function isActiveUserSubscription(
  sub: Pick<UserSubscription, 'status' | 'end_time'> | null | undefined,
  now: number
): boolean {
  return sub?.status === 'active' && (sub?.end_time || 0) > now
}

/**
 * Lower number = higher consume / display priority.
 * Mirrors model.subscriptionConsumeRank: custom assignment (plan_id <= 0),
 * then admin-bound plans, then purchased orders.
 */
export function subscriptionConsumeRank(
  sub: Pick<UserSubscription, 'plan_id' | 'source'> | null | undefined
): number {
  if ((sub?.plan_id || 0) <= 0) return 0
  if (sub?.source === 'admin') return 1
  return 2
}

/**
 * Display-only ordering that mirrors backend billing candidate order.
 * Must never be used for billing.
 */
type SubscriptionSortFields = Pick<
  UserSubscription,
  'status' | 'end_time' | 'plan_id' | 'source'
>

export function compareSubscriptionsForDisplay(
  a: SubscriptionSortFields | null | undefined,
  b: SubscriptionSortFields | null | undefined,
  now: number
): number {
  const av = isActiveUserSubscription(a, now)
  const bv = isActiveUserSubscription(b, now)
  if (av !== bv) return av ? -1 : 1
  if (av) {
    const rankDiff = subscriptionConsumeRank(a) - subscriptionConsumeRank(b)
    if (rankDiff !== 0) return rankDiff
    return (a?.end_time || 0) - (b?.end_time || 0)
  }
  return (b?.end_time || 0) - (a?.end_time || 0)
}
