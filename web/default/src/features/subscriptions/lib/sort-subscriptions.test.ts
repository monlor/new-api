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
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { compareSubscriptionsForDisplay } from './sort-subscriptions.ts'

describe('compareSubscriptionsForDisplay', () => {
  const now = 1_000_000

  test('puts custom assignment above admin-bound plan even when it expires later', () => {
    const custom = {
      id: 59,
      user_id: 1,
      plan_id: 0,
      status: 'active',
      source: 'admin',
      start_time: now,
      end_time: now + 30 * 86400,
      amount_total: 50,
      amount_used: 0,
    }
    const adminPlan = {
      id: 36,
      user_id: 1,
      plan_id: 8,
      status: 'active',
      source: 'admin',
      start_time: now,
      end_time: now + 7 * 86400,
      amount_total: 252,
      amount_used: 192,
    }
    const order = {
      id: 45,
      user_id: 1,
      plan_id: 9,
      status: 'active',
      source: 'order',
      start_time: now,
      end_time: now + 22 * 86400,
      amount_total: 84,
      amount_used: 0,
    }

    const sorted = [adminPlan, custom, order].sort((a, b) =>
      compareSubscriptionsForDisplay(a, b, now)
    )
    assert.deepEqual(
      sorted.map((s) => s.id),
      [59, 36, 45]
    )
  })
})
