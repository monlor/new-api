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
import { AreaChart as LineIcon, BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatChartTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import type { RevenueTrendPoint } from '../types'

type ChartKind = 'bar' | 'line'

const CHART_KIND_ICONS: Record<ChartKind, typeof BarChart3> = {
  bar: BarChart3,
  line: LineIcon,
}

/**
 * Revenue over time. Backend `money` is system USD (Epay CNY already divided
 * by Price). formatBillingCurrencyFromUSD — not formatCurrencyFromUSD, which
 * multiplies by quotaPerUnit under TOKENS and would render $100 as "50000k".
 */
export function RevenueTrendChart(props: {
  data: RevenueTrendPoint[]
  /** Bucket width in seconds (3600 = hourly, 86400 = daily). */
  bucketSize?: number
  loading?: boolean
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<ChartKind>('bar')

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      money: { label: t('Revenue'), color: 'var(--chart-1)' },
    }),
    [t]
  )

  const chartData = useMemo(() => {
    const granularity = props.bucketSize === 3600 ? 'hour' : 'day'
    return props.data.map((point) => ({
      label: formatChartTime(point.bucket, granularity),
      money: Number(point.money) || 0,
      count: Number(point.count) || 0,
    }))
  }, [props.data, props.bucketSize])

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5'>
        <div className='text-sm font-semibold'>{t('Revenue Trend')}</div>
        <div className='bg-muted/60 inline-flex h-8 items-center rounded-lg border p-0.5'>
          {(['bar', 'line'] as const).map((option) => {
            const Icon = CHART_KIND_ICONS[option]
            return (
              <Button
                key={option}
                type='button'
                size='sm'
                variant={kind === option ? 'default' : 'ghost'}
                className='h-7 px-2'
                aria-label={option === 'bar' ? t('Bar chart') : t('Line chart')}
                onClick={() => setKind(option)}
              >
                <Icon className='size-3.5' />
              </Button>
            )
          })}
        </div>
      </div>

      <div className='p-3'>
        {props.loading ? (
          <Skeleton className='h-64 w-full' />
        ) : chartData.length === 0 ? (
          <div className='text-muted-foreground flex h-64 items-center justify-center text-sm'>
            {t('No revenue in the selected period')}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className={cn('h-64 w-full')}>
            <RevenueTrendPlot kind={kind} data={chartData} />
          </ChartContainer>
        )}
      </div>
    </div>
  )
}

function RevenueTrendPlot(props: {
  kind: ChartKind
  data: { label: string; money: number; count: number }[]
}) {
  const ChartImpl = props.kind === 'bar' ? BarChart : LineChart
  return (
    <ChartImpl data={props.data}>
      <CartesianGrid vertical={false} strokeDasharray='3 3' />
      <XAxis
        dataKey='label'
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={16}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={64}
        tickFormatter={(value: number) => formatBillingCurrencyFromUSD(value)}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            formatter={(value) => formatBillingCurrencyFromUSD(Number(value))}
          />
        }
      />
      {props.kind === 'bar' ? (
        <Bar dataKey='money' fill='var(--color-money)' radius={4} />
      ) : (
        <Line
          dataKey='money'
          stroke='var(--color-money)'
          strokeWidth={2}
          dot={false}
        />
      )}
    </ChartImpl>
  )
}
