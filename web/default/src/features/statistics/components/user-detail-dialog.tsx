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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { getUserUsageDetail } from '../api'
import { formatOriginalValueUsd } from '../lib/format'
import type {
  StatisticsTimeRange,
  UserModelUsageItem,
  UserTokenUsageItem,
  UserUsageItem,
} from '../types'

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

/** Shared share/percentage bar used by the per-model table. */
function ShareBar(props: { value: number }) {
  const pct = Math.max(0, Math.min(100, Number(props.value)))
  return (
    <div className='flex items-center gap-2'>
      <div className='bg-muted h-1.5 w-16 overflow-hidden rounded-full'>
        <div
          className='bg-primary h-full rounded-full'
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className='text-muted-foreground text-xs tabular-nums'>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
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

function useModelColumns(): StaticDataTableColumn<UserModelUsageItem>[] {
  const { t } = useTranslation()

  return [
    {
      id: 'model_name',
      header: t('Model'),
      cell: (row) => (
        <span className='font-medium'>{row.model_name || '-'}</span>
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
      id: 'percentage',
      header: t('Share'),
      cell: (row) => <ShareBar value={row.percentage} />,
    },
  ]
}

function SummaryItem(props: { label: string; value: string }) {
  return (
    <div className='space-y-1'>
      <Label className='text-muted-foreground text-xs'>{props.label}</Label>
      <div className='text-sm font-semibold tabular-nums'>{props.value}</div>
    </div>
  )
}

function SectionTitle(props: { children: string }) {
  return (
    <h3 className='text-muted-foreground mb-2 text-xs font-medium'>
      {props.children}
    </h3>
  )
}

interface UserDetailDialogProps {
  /** The clicked row. `null` keeps the dialog closed and the query disabled. */
  user: UserUsageItem | null
  range: StatisticsTimeRange
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Per-user usage detail: period summary plus the per-API-key and per-model
 * breakdowns, fetched in a single request once the dialog opens.
 *
 * The summary comes from the model rows (no `token_id` filter), so it is the
 * user's true period total — the API key table can sum to less when some calls
 * had no associated key.
 */
export function UserDetailDialog({
  user,
  range,
  open,
  onOpenChange,
}: UserDetailDialogProps) {
  const { t } = useTranslation()
  const tokenColumns = useTokenColumns()
  const modelColumns = useModelColumns()
  const userId = user?.user_id ?? null

  const { data, isLoading, isError } = useQuery({
    queryKey: ['statistics', 'user-detail', userId, range],
    queryFn: async () =>
      getUserUsageDetail({ user_id: userId as number, ...range }),
    enabled: open && userId !== null,
    staleTime: 60 * 1000,
  })

  const summary = data?.data?.summary
  const tokens = data?.data?.tokens ?? []
  const models = data?.data?.models ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${t('Usage Details')}${user?.username ? ` · ${user.username}` : ''}`}
      description={t('Usage breakdown for this user in the selected period')}
      contentClassName='sm:max-w-3xl'
      bodyClassName='space-y-5'
    >
      {isLoading ? (
        <div className='space-y-2 py-2'>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className='h-7 w-full' />
          ))}
        </div>
      ) : isError ? (
        <div className='text-muted-foreground py-8 text-center text-sm'>
          {t('Failed to load usage details')}
        </div>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
            <SummaryItem
              label={t('Requests')}
              value={formatNumber(summary?.count ?? 0)}
            />
            <SummaryItem
              label={t('Tokens')}
              value={formatTokens(summary?.token_used ?? 0)}
            />
            <SummaryItem
              label={t('Spend')}
              value={formatQuota(summary?.quota ?? 0)}
            />
            <SummaryItem
              label={t('Original Value')}
              value={formatOriginalValueUsd(summary?.original_value_usd)}
            />
          </div>

          <div>
            <SectionTitle>{t('API Keys')}</SectionTitle>
            <StaticDataTable
              columns={tokenColumns}
              data={tokens}
              getRowKey={(row) => row.token_id}
              empty={tokens.length === 0}
              emptyContent={t('No API key usage in this period')}
              tableClassName='text-xs'
            />
          </div>

          <div>
            <SectionTitle>{t('Models')}</SectionTitle>
            <StaticDataTable
              columns={modelColumns}
              data={models}
              getRowKey={(row) => row.model_name}
              empty={models.length === 0}
              emptyContent={t('No model usage in this period')}
              tableClassName='text-xs'
            />
          </div>
        </>
      )}
    </Dialog>
  )
}
