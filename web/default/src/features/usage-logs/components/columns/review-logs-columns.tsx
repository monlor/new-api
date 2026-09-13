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
import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import {
  formatLogQuota,
  formatTimestampToDate,
  formatTokens,
} from '@/lib/format'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { getContentReviewDecisionConfig } from '../../lib/review'
import type { ContentReviewLog } from '../../types'
import { ReviewDetailsDialog } from '../dialogs/review-details-dialog'
import { useUsageLogsContext } from '../usage-logs-provider'

export function useReviewLogsColumns(): ColumnDef<ContentReviewLog>[] {
  const { t } = useTranslation()
  const { sensitiveVisible } = useUsageLogsContext()

  return [
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) => (
        <span className='font-mono text-xs tabular-nums'>
          {formatTimestampToDate(row.original.created_at)}
        </span>
      ),
      enableHiding: false,
      size: 160,
    },
    {
      accessorKey: 'username',
      header: t('User'),
      cell: ({ row }) => (
        <span className='text-xs'>
          {sensitiveVisible ? row.original.username || '-' : '••••'}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: 'original_model',
      header: t('Original Model'),
      cell: ({ row }) => (
        <span className='font-mono text-xs'>
          {row.original.original_model || '-'}
        </span>
      ),
      size: 140,
    },
    {
      accessorKey: 'review_model',
      header: t('Review model'),
      cell: ({ row }) => (
        <span className='font-mono text-xs'>
          {row.original.review_model || '-'}
        </span>
      ),
      size: 140,
    },
    {
      accessorKey: 'decision',
      header: t('Decision'),
      cell: ({ row }) => {
        const config = getContentReviewDecisionConfig(row.original.decision)
        return (
          <StatusBadge
            label={t(config.label)}
            variant={config.variant}
            size='sm'
            copyable={false}
          />
        )
      },
      size: 110,
    },
    {
      accessorKey: 'confidence',
      header: t('Confidence'),
      cell: ({ row }) => (
        <span className='font-mono text-xs tabular-nums'>
          {row.original.confidence == null
            ? '-'
            : row.original.confidence.toFixed(2)}
        </span>
      ),
      size: 90,
    },
    {
      id: 'tokens',
      header: t('Tokens'),
      cell: ({ row }) => (
        <span className='font-mono text-xs tabular-nums'>
          {formatTokens(row.original.prompt_tokens ?? 0)} /{' '}
          {formatTokens(row.original.completion_tokens ?? 0)}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: 'estimated_quota',
      header: t('Estimated Cost'),
      cell: ({ row }) => (
        <span className='font-mono text-xs tabular-nums'>
          {formatLogQuota(row.original.estimated_quota ?? 0)}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: 'use_time_ms',
      header: t('Latency'),
      cell: ({ row }) => (
        <span className='font-mono text-xs tabular-nums'>
          {row.original.use_time_ms ? `${row.original.use_time_ms}ms` : '-'}
        </span>
      ),
      size: 90,
    },
    {
      id: 'actions',
      header: t('Details'),
      cell: function DetailsCell({ row }) {
        const [open, setOpen] = useState(false)
        return (
          <>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={() => setOpen(true)}
            >
              {t('View')}
            </Button>
            <ReviewDetailsDialog
              log={row.original}
              open={open}
              onOpenChange={setOpen}
            />
          </>
        )
      },
      size: 80,
    },
  ]
}
