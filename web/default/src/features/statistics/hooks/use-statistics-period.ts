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
import { useMemo, useState } from 'react'
import dayjs from '@/lib/dayjs'
import type { StatisticsPeriodId, StatisticsTimeRange } from '../types'

export type StatisticsPeriod = {
  id: StatisticsPeriodId
  /** Resolved window in Unix seconds, always defined. */
  range: StatisticsTimeRange
  /** Custom-range drafts, only meaningful when `id === 'custom'`. */
  customStart?: Date
  customEnd?: Date
}

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

/**
 * Resolve a preset id into a concrete Unix-second window.
 *
 * `today` is the calendar day, `7d` / `30d` are inclusive day windows ending
 * today — matching the presets already used by the usage-logs range picker so
 * numbers line up between the two pages.
 */
export function resolvePeriodRange(
  id: StatisticsPeriodId,
  customStart?: Date,
  customEnd?: Date
): StatisticsTimeRange {
  const now = dayjs()

  if (id === 'custom') {
    const start = customStart ?? now.subtract(6, 'day').startOf('day').toDate()
    const end = customEnd ?? now.endOf('day').toDate()
    return { start_timestamp: toUnix(start), end_timestamp: toUnix(end) }
  }

  const days = id === 'today' ? 0 : id === '7d' ? 6 : 29

  return {
    start_timestamp: toUnix(now.subtract(days, 'day').startOf('day').toDate()),
    end_timestamp: toUnix(now.endOf('day').toDate()),
  }
}

/**
 * Period selector state shared by both statistics tabs. Each tab keeps its own
 * instance so switching tabs does not reset the other one's window.
 */
export function useStatisticsPeriod(initial: StatisticsPeriodId) {
  const [periodId, setPeriodId] = useState<StatisticsPeriodId>(initial)
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined)
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined)

  const range = useMemo(
    () => resolvePeriodRange(periodId, customStart, customEnd),
    [periodId, customStart, customEnd]
  )

  const setCustomRange = (next: { start?: Date; end?: Date }) => {
    setCustomStart(next.start)
    setCustomEnd(next.end)
    setPeriodId('custom')
  }

  return {
    periodId,
    setPeriodId,
    customStart,
    customEnd,
    setCustomRange,
    range,
  }
}
