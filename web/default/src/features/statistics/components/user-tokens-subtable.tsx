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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  formatNumber,
  formatQuota,
  formatTimestampToDate,
  formatTokens,
} from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { getUserTokenStatistics } from '../api'
import { formatOriginalValueUsd } from '../lib/format'
import type { StatisticsTimeRange, UserTokenUsageItem } from '../types'

/**
 * Token status values mirror `model.Token.Status` (1 = enabled). The backend
 * returns an explicit `-1` for tokens that were soft-deleted and can no longer
 * be resolved; a missing value is treated the same way defensively.
 */
function TokenStatusCell(props: { status?: number }) {
  const { t } = useTranslation()

  if (props.status === undefined || props.status === null || props.status < 0) {
    return (
      <StatusBadge label={t('Deleted')} variant='neutral' copyable={false} />
    )
  }

  if (props.status === 1) {
    return (
      <StatusBadge label={t('Enabled')} variant='success' copyable={false} />
    )
  }

  return <StatusBadge label={t('Disabled')} variant='danger' copyable={false} />
}

function useTokenColumns(): StaticDataTableColumn<UserTokenUsageItem>[] {
  const { t } = useTranslation()

  return [
    {
      id: 'token_name',
      header: t('API Key Name'),
      cell: (row) => (
        <span className='font-medium'>
          {row.token_name || t('Unnamed key')}
        </span>
      ),
    },
    {
      id: 'request_count',
      header: t('Requests'),
      cellClassName: 'tabular-nums',
      cell: (row) => formatNumber(row.request_count),
    },
    {
      id: 'token_used',
      header: t('Tokens'),
      cellClassName: 'tabular-nums',
      cell: (row) => formatTokens(row.token_used),
    },
    {
      id: 'quota',
      header: t('Spend'),
      cellClassName: 'tabular-nums',
      cell: (row) => formatQuota(row.quota),
    },
    {
      id: 'original_value_usd',
      header: t('Original Value'),
      cellClassName: 'tabular-nums',
      cell: (row) => formatOriginalValueUsd(row.original_value_usd),
    },
    {
      id: 'last_used_at',
      header: t('Last Used'),
      cellClassName: 'tabular-nums',
      cell: (row) => formatTimestampToDate(row.last_used_at),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (row) => <TokenStatusCell status={row.status} />,
    },
  ]
}

/**
 * Inline drill-down rendered under an expanded user row: per-API-key usage for
 * that user within the selected period. Fetched lazily, only once the row is
 * actually expanded.
 */
export function UserTokensSubtable(props: {
  userId: number
  range: StatisticsTimeRange
}) {
  const { t } = useTranslation()
  const columns = useTokenColumns()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['statistics', 'user-tokens', props.userId, props.range],
    queryFn: async () =>
      getUserTokenStatistics({ user_id: props.userId, ...props.range }),
    staleTime: 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className='space-y-1.5 p-3'>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className='h-7 w-full' />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className='text-muted-foreground p-3 text-xs'>
        {t('Failed to load API key usage')}
      </div>
    )
  }

  const items = data?.data?.items ?? []

  return (
    <div className='p-3'>
      <StaticDataTable
        columns={columns}
        data={items}
        getRowKey={(row) => row.token_id}
        empty={items.length === 0}
        emptyContent={t('No API key usage in this period')}
        tableClassName='text-xs'
      />
    </div>
  )
}
