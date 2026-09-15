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
import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ExpandedState } from '@tanstack/react-table'
import { Coins, DollarSign, Hash, Layers, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import { TableCell, TableRow } from '@/components/ui/table'
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
import { UserTokensSubtable } from './user-tokens-subtable'
import { useUserUsageColumns } from './user-usage-columns'

const DEFAULT_PAGE_SIZE = 20

export function UserUsageTab() {
  const { t } = useTranslation()
  const columns = useUserUsageColumns()
  const period = useStatisticsPeriod(STATISTICS_DEFAULT_PERIOD)

  const [keyword, setKeyword] = useState('')
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  })
  const [expanded, setExpanded] = useState<ExpandedState>({})

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
    expanded,
    onExpandedChange: setExpanded,
    withExpandedRowModel: true,
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
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <StatisticsKpiCards
        items={kpiCards}
        loading={isLoading}
        error={isError}
        className='xl:grid-cols-5'
      />

      <div className='flex min-h-0 flex-1 flex-col'>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
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
          renderRow={(row) => (
            <Fragment key={row.id}>
              <DataTableRow
                row={row}
                className='transition-colors'
                getColumnClassName={() => 'py-2'}
              />
              {row.getIsExpanded() && (
                <TableRow className='hover:bg-transparent'>
                  <TableCell
                    colSpan={row.getVisibleCells().length}
                    className='bg-muted/30 p-0'
                  >
                    <UserTokensSubtable
                      userId={row.original.user_id}
                      range={period.range}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )}
        />
      </div>
    </div>
  )
}
