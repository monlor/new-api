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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Cell, Pie, PieChart } from 'recharts'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { REVENUE_FALLBACK_COLORS, REVENUE_PROVIDER_COLORS } from '../constants'
import type { RevenueProviderShare } from '../types'

function providerColor(provider: string, index: number): string {
  return (
    REVENUE_PROVIDER_COLORS[provider] ??
    REVENUE_FALLBACK_COLORS[index % REVENUE_FALLBACK_COLORS.length]
  )
}

/** Share of revenue per payment provider. */
export function RevenueProviderChart(props: {
  data: RevenueProviderShare[]
  loading?: boolean
}) {
  const { t } = useTranslation()

  const slices = useMemo(
    () =>
      props.data.map((item, index) => ({
        provider: item.provider || t('Unknown'),
        money: Number(item.money) || 0,
        count: Number(item.count) || 0,
        percentage: Number(item.percentage) || 0,
        fill: providerColor(item.provider, index),
      })),
    [props.data, t]
  )

  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = { money: { label: t('Revenue') } }
    slices.forEach((slice) => {
      config[slice.provider] = { label: slice.provider, color: slice.fill }
    })
    return config
  }, [slices, t])

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='border-b px-4 py-2.5 text-sm font-semibold'>
        {t('Revenue by Payment Method')}
      </div>
      <div className='p-3'>
        {props.loading ? (
          <Skeleton className='h-64 w-full' />
        ) : slices.length === 0 ? (
          <div className='text-muted-foreground flex h-64 items-center justify-center text-sm'>
            {t('No revenue in the selected period')}
          </div>
        ) : (
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
            <ChartContainer
              config={chartConfig}
              className='aspect-square h-52 w-52 shrink-0'
            >
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      nameKey='provider'
                      formatter={(value) =>
                        formatBillingCurrencyFromUSD(Number(value))
                      }
                    />
                  }
                />
                <Pie
                  data={slices}
                  dataKey='money'
                  nameKey='provider'
                  innerRadius={48}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.provider} fill={slice.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>

            <ul className='min-w-0 flex-1 space-y-1.5'>
              {slices.map((slice) => (
                <li
                  key={slice.provider}
                  className='flex items-center justify-between gap-3 text-xs'
                >
                  <span className='flex min-w-0 items-center gap-2'>
                    <span
                      className='size-2 shrink-0 rounded-sm'
                      style={{ backgroundColor: slice.fill }}
                      aria-hidden='true'
                    />
                    <span className='truncate font-medium'>
                      {slice.provider}
                    </span>
                  </span>
                  <span className='text-muted-foreground shrink-0 tabular-nums'>
                    {formatBillingCurrencyFromUSD(slice.money)} ·{' '}
                    {slice.percentage.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
