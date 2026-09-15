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
import { useQuery } from '@tanstack/react-query'
import { Receipt, ShoppingCart, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getRevenueStatistics } from '../api'
import {
  REVENUE_PROVIDER_OPTIONS,
  STATISTICS_DEFAULT_PERIOD,
} from '../constants'
import { useStatisticsPeriod } from '../hooks/use-statistics-period'
import { PeriodSelector } from './period-selector'
import { RevenueProviderChart } from './revenue-provider-chart'
import { RecentTopUpsTable, TopRechargeUsersTable } from './revenue-tables'
import { RevenueTrendChart } from './revenue-trend-chart'
import {
  StatisticsKpiCards,
  type StatisticsKpiCard,
} from './statistics-kpi-cards'

export function RevenueTab() {
  const { t } = useTranslation()
  const period = useStatisticsPeriod(STATISTICS_DEFAULT_PERIOD)
  const [provider, setProvider] = useState('all')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['statistics', 'revenue', period.range, provider],
    queryFn: async () =>
      getRevenueStatistics({
        ...period.range,
        provider: provider === 'all' ? undefined : provider,
      }),
    placeholderData: (previous) => previous,
    staleTime: 30 * 1000,
  })

  const revenue = data?.data
  const summary = revenue?.summary

  const providerItems = useMemo(
    () =>
      REVENUE_PROVIDER_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t]
  )

  const trendSparkline = useMemo(
    () => (revenue?.trend ?? []).map((point) => Number(point.money) || 0),
    [revenue?.trend]
  )

  const kpiCards: StatisticsKpiCard[] = [
    {
      key: 'total',
      title: t('Total Revenue'),
      value: formatBillingCurrencyFromUSD(summary?.total_money ?? 0),
      description: t('Paid orders in the selected period'),
      icon: Wallet,
      tone: 'teal',
      sparkline: trendSparkline,
      growthPct: summary?.money_growth_pct,
    },
    {
      key: 'orders',
      title: t('Recharge Orders'),
      value: formatNumber(summary?.order_count ?? 0),
      description: t('Number of successful recharges'),
      icon: ShoppingCart,
      tone: 'rose',
    },
    {
      key: 'aov',
      title: t('Average Order Value'),
      value: formatBillingCurrencyFromUSD(summary?.avg_order_value ?? 0),
      description: t('Total revenue divided by order count'),
      icon: Receipt,
      tone: 'gray',
    },
  ]

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <PeriodSelector
          value={period.periodId}
          onChange={period.setPeriodId}
          customStart={period.customStart}
          customEnd={period.customEnd}
          onCustomRangeChange={period.setCustomRange}
        />

        <Select
          items={providerItems}
          value={provider}
          onValueChange={(value) => setProvider(value === null ? 'all' : value)}
        >
          <SelectTrigger className='h-8 w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {providerItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <StatisticsKpiCards
        items={kpiCards}
        loading={isLoading}
        error={isError}
      />

      <div className='grid gap-3 xl:grid-cols-2'>
        <RevenueTrendChart
          data={revenue?.trend ?? []}
          bucketSize={revenue?.bucket_size}
          loading={isLoading}
        />
        <RevenueProviderChart
          data={revenue?.by_provider ?? []}
          loading={isLoading}
        />
      </div>

      <div className='grid gap-3 xl:grid-cols-2'>
        <TopRechargeUsersTable
          data={revenue?.top_users ?? []}
          loading={isLoading}
        />
        <RecentTopUpsTable data={revenue?.recent ?? []} loading={isLoading} />
      </div>
    </div>
  )
}
