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
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { STATISTICS_PERIOD_OPTIONS } from '../constants'
import type { StatisticsPeriodId } from '../types'

type PeriodSelectorProps = {
  value: StatisticsPeriodId
  onChange: (id: StatisticsPeriodId) => void
  customStart?: Date
  customEnd?: Date
  onCustomRangeChange: (range: { start?: Date; end?: Date }) => void
  className?: string
}

/**
 * Today / 7 days / 30 days / custom period switcher. Picking "Custom" reveals
 * the shared compact range picker; picking any preset hides it again.
 */
export function PeriodSelector(props: PeriodSelectorProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-wrap items-center gap-2', props.className)}>
      <div className='bg-muted/60 inline-flex h-8 items-center rounded-lg border p-0.5'>
        {STATISTICS_PERIOD_OPTIONS.map((option) => (
          <Button
            key={option.id}
            type='button'
            size='sm'
            variant={props.value === option.id ? 'default' : 'ghost'}
            className='h-7 px-2.5 text-xs'
            onClick={() => props.onChange(option.id)}
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </div>

      {props.value === 'custom' && (
        <CompactDateTimeRangePicker
          start={props.customStart}
          end={props.customEnd}
          onChange={props.onCustomRangeChange}
          className='h-8 w-auto min-w-64'
        />
      )}
    </div>
  )
}
