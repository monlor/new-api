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
import { useMediaQuery } from '@/hooks'
import { Coins, DollarSign, Hash, Layers, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DataTablePage,
  DataTableRow,
  useDataTable,
} from '@/components/data-table'
import { getUserStatistics } from '../api'
import { STATISTICS_DEFAULT_PERIOD } from '../constants'
import { useStatisticsPeriod } from '../hooks/use-statistics-period'
import { formatOriginalValueUsd } from '../lib/format'
import type { UserUsageItem } from '../types'
import { PeriodSelector } from './period-selector'
import {
  StatisticsKpiCards,
  type StatisticsKpiCard,
} from './statistics-kpi-cards'
import { UserDetailDialog } from './user-detail-dialog'
import { useUserUsageColumns } from './user-usage-columns'

const DEFAULT_PAGE_SIZE = 20

export function UserUsageTab() {
  const { t } = useTranslation()
  const columns = useUserUsageColumns()
  const period = useStatisticsPeriod(STATISTICS_DEFAULT_PERIOD)
  const isMobile = useMediaQuery('(max-width: 640px)')

  const [keyword, setKeyword] = useState('')
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  })
  const [detailUser, setDetailUser] = useState<UserUsageItem | null>(null)

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: [
      'statistics',
      'users',
      period.range,
      keyword,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ],
    queryFn: async () =>
      getUserStatistics({
        ...period.range,
        keyword: keyword.trim().length >= 2 ? keyword.trim() : undefined,
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previous) => previous,
    staleTime: 30 * 1000,
  })

  const items = useMemo(() => data?.data?.items ?? [], [data])
  const summary = data?.data?.summary

  // The toolbar's built-in search input writes through the table's
  // globalFilter. Filtering happens server-side (`manualFiltering`), so we
  // mirror it into `keyword` and reset to page 1 on every change.
  const handleGlobalFilterChange = (
    updater: string | ((old: string) => string)
  ) => {
    setKeyword((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      if (next !== previous) {
        setPagination((state) => ({ ...state, pageIndex: 0 }))
      }
      return next
    })
  }

  const { table } = useDataTable<UserUsageItem>({
    data: items,
    columns,
    getRowId: (row) => String(row.user_id),
    manualPagination: true,
    manualFiltering: true,
    pagination,
    onPaginationChange: setPagination,
    globalFilter: keyword,
    onGlobalFilterChange: handleGlobalFilterChange,
    totalCount: data?.data?.total ?? 0,
  })

  const kpiCards: StatisticsKpiCard[] = [
    {
      key: 'quota',
      title: t('Total Spend'),
      value: formatQuota(summary?.total_quota ?? 0),
      description: t('Consumption across all users in the selected period'),
      icon: Coins,
      tone: 'teal',
      growthPct: summary?.quota_growth_pct,
    },
    {
      key: 'original_value',
      title: t('Original Value'),
      value: formatOriginalValueUsd(summary?.original_value_usd),
      description: t(
        "Estimated official USD value at each model's cheapest available group × channel ratio, markup excluded"
      ),
      icon: DollarSign,
      tone: 'blue',
    },
    {
      key: 'count',
      title: t('Total Requests'),
      value: formatNumber(summary?.total_count ?? 0),
      description: t('Total API calls in the selected period'),
      icon: Hash,
      tone: 'rose',
      growthPct: summary?.count_growth_pct,
    },
    {
      key: 'tokens',
      title: t('Total Tokens'),
      value: formatTokens(summary?.total_tokens ?? 0),
      description: t('Prompt and completion tokens combined'),
      icon: Layers,
      tone: 'gray',
    },
    {
      key: 'users',
      title: t('Active Users'),
      value: formatNumber(summary?.active_users ?? 0),
      description: t('Users with at least one request'),
      icon: Users,
      tone: 'gray',
    },
  ]

  const handleReset = () => {
    setKeyword('')
    setPagination((previous) => ({ ...previous, pageIndex: 0 }))
  }

  return (
    <div className={cn('flex flex-col gap-3', !isMobile && 'h-full min-h-0')}>
      <StatisticsKpiCards
        items={kpiCards}
        loading={isLoading}
        error={isError}
        className='xl:grid-cols-5'
      />

      <div className={cn('flex flex-col', !isMobile && 'min-h-0 flex-1')}>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          fixedHeight={!isMobile}
          emptyTitle={t('No Usage Data Found')}
          emptyDescription={t(
            'No user consumption recorded in the selected period.'
          )}
          skeletonKeyPrefix='statistics-users-skeleton'
          applyHeaderSize
          toolbarProps={{
            searchPlaceholder: t('Filter by username...'),
            searchDebounceMs: 400,
            hasAdditionalFilters: Boolean(keyword),
            onReset: handleReset,
            additionalSearch: (
              <PeriodSelector
                value={period.periodId}
                onChange={(id) => {
                  period.setPeriodId(id)
                  setPagination((previous) => ({ ...previous, pageIndex: 0 }))
                }}
                customStart={period.customStart}
                customEnd={period.customEnd}
                onCustomRangeChange={(range) => {
                  period.setCustomRange(range)
                  setPagination((previous) => ({ ...previous, pageIndex: 0 }))
                }}
              />
            ),
          }}
          mobileProps={{
            onRowClick: (row) => setDetailUser(row.original),
          }}
          renderRow={(row) => (
            <DataTableRow
              key={row.id}
              row={row}
              className='hover:bg-muted/50 cursor-pointer transition-colors'
              getColumnClassName={() => 'py-2'}
              role='button'
              tabIndex={0}
              aria-label={t('View usage details')}
              onClick={() => setDetailUser(row.original)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setDetailUser(row.original)
              }}
            />
          )}
        />
      </div>

      <UserDetailDialog
        user={detailUser}
        range={period.range}
        open={detailUser !== null}
        onOpenChange={(open) => {
          if (!open) setDetailUser(null)
        }}
      />
    </div>
  )
}
