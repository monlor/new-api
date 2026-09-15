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
import { type ColumnDef } from '@tanstack/react-table'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { formatOriginalValueUsd } from '../lib/format'
import type { UserUsageItem } from '../types'
import { TrendSparkline } from './trend-sparkline'

export function useUserUsageColumns(): ColumnDef<UserUsageItem>[] {
  const { t } = useTranslation()

  return [
    {
      id: 'expander',
      header: '',
      cell: ({ row }) => (
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-7'
          aria-label={t('View API key breakdown')}
          aria-expanded={row.getIsExpanded()}
          onClick={(event) => {
            event.stopPropagation()
            row.toggleExpanded()
          }}
        >
          <ChevronRight
            className={cn(
              'size-4 transition-transform',
              row.getIsExpanded() && 'rotate-90'
            )}
          />
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 48,
    },
    {
      accessorKey: 'username',
      header: t('Username'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <span className='font-medium'>{row.original.username || '-'}</span>
      ),
      size: 200,
    },
    {
      accessorKey: 'count',
      header: t('Requests'),
      cell: ({ row }) => (
        <span className='tabular-nums'>{formatNumber(row.original.count)}</span>
      ),
      size: 120,
    },
    {
      accessorKey: 'token_used',
      header: t('Tokens'),
      cell: ({ row }) => (
        <span className='tabular-nums'>
          {formatTokens(row.original.token_used)}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: 'quota',
      header: t('Spend'),
      cell: ({ row }) => (
        <span className='font-medium tabular-nums'>
          {formatQuota(row.original.quota)}
        </span>
      ),
      size: 140,
    },
    {
      accessorKey: 'original_value_usd',
      header: t('Original Value'),
      cell: ({ row }) => (
        <span className='text-muted-foreground tabular-nums'>
          {formatOriginalValueUsd(row.original.original_value_usd)}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: 'percentage',
      header: t('Share'),
      cell: ({ row }) => {
        const pct = Math.max(0, Math.min(100, Number(row.original.percentage)))
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
      },
      size: 160,
    },
    {
      id: 'trend',
      header: t('Trend'),
      cell: ({ row }) => <TrendSparkline values={row.original.trend} />,
      enableSorting: false,
      size: 110,
    },
  ]
}
