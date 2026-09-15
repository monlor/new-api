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
import { StaggerContainer, StaggerItem } from '@/components/page-transition'
import {
  StatCard,
  type StatCardProps,
} from '@/features/dashboard/components/ui/stat-card'

export type StatisticsKpiCard = Pick<
  StatCardProps,
  'title' | 'value' | 'description' | 'icon' | 'tone' | 'sparkline'
> & {
  key: string
  /** Period-over-period change in percent. Omit to hide the delta chip. */
  growthPct?: number
}

function GrowthChip(props: { value: number }) {
  const { t } = useTranslation()
  const rounded = Math.round(props.value * 10) / 10
  const isFlat = rounded === 0
  const isUp = rounded > 0

  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[11px] leading-none font-medium tabular-nums',
        isFlat && 'bg-muted text-muted-foreground',
        !isFlat && isUp && 'bg-success/10 text-success',
        !isFlat && !isUp && 'bg-destructive/10 text-destructive'
      )}
      title={t('Compared to the previous period')}
    >
      {isFlat ? '±0%' : `${isUp ? '+' : ''}${rounded}%`}
    </span>
  )
}

/**
 * KPI card row shared by both statistics tabs. Reuses the dashboard StatCard
 * so the visual language stays identical, and layers a period-over-period
 * delta chip on top via the card's `action` slot.
 */
export function StatisticsKpiCards(props: {
  items: StatisticsKpiCard[]
  loading?: boolean
  error?: boolean
  className?: string
}) {
  return (
    <StaggerContainer
      className={cn(
        'grid gap-3 sm:grid-cols-2 xl:grid-cols-4',
        props.className
      )}
    >
      {props.items.map((item) => (
        <StaggerItem key={item.key} className='bg-card rounded-xl border p-3'>
          <StatCard
            title={item.title}
            value={item.value}
            description={item.description}
            icon={item.icon}
            tone={item.tone}
            sparkline={item.sparkline}
            sparklineVariant='line'
            loading={props.loading}
            error={props.error}
            action={
              item.growthPct === undefined ? undefined : (
                <GrowthChip value={item.growthPct} />
              )
            }
          />
        </StaggerItem>
      ))}
    </StaggerContainer>
  )
}
