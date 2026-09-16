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
import { useTranslation } from 'react-i18next'
import { formatTimestampToDate } from '@/lib/format'
import { TruncatedCell } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { SYSTEM_LOG_TYPES } from '../constants'
import type { SystemLog } from '../types'

export function useSystemLogsColumns(): ColumnDef<SystemLog>[] {
  const { t } = useTranslation()

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
      accessorKey: 'type',
      header: t('Type'),
      cell: ({ row }) => {
        const config = SYSTEM_LOG_TYPES[row.original.type]
        if (!config) {
          return <span className='text-muted-foreground/60 text-xs'>-</span>
        }
        return (
          <StatusBadge
            label={t(config.labelKey)}
            variant={config.variant}
            size='sm'
            copyable={false}
          />
        )
      },
      size: 160,
    },
    {
      accessorKey: 'username',
      header: t('User'),
      cell: ({ row }) => (
        <span className='text-xs'>{row.original.username || '-'}</span>
      ),
      size: 120,
    },
    {
      accessorKey: 'content',
      header: t('Content'),
      cell: ({ row }) => {
        const content = row.original.content?.trim()
        if (!content) {
          return <span className='text-muted-foreground/60 text-xs'>-</span>
        }
        return (
          <TruncatedCell
            className='max-w-[320px] text-xs'
            tooltipClassName='max-w-sm whitespace-pre-wrap break-words'
            tooltipContent={content}
          >
            {content}
          </TruncatedCell>
        )
      },
      enableSorting: false,
      size: 320,
    },
    {
      accessorKey: 'model_name',
      header: t('Model'),
      cell: ({ row }) => (
        <span className='font-mono text-xs'>
          {row.original.model_name || '-'}
        </span>
      ),
      size: 140,
    },
    {
      accessorKey: 'group',
      header: t('Group'),
      cell: ({ row }) => (
        <span className='font-mono text-xs'>{row.original.group || '-'}</span>
      ),
      size: 120,
    },
    {
      accessorKey: 'ip',
      header: t('IP'),
      cell: ({ row }) => (
        <span className='font-mono text-xs'>{row.original.ip || '-'}</span>
      ),
      size: 130,
    },
    {
      accessorKey: 'user_agent',
      header: t('User Agent'),
      cell: ({ row }) => {
        const userAgent = row.original.user_agent?.trim()
        if (!userAgent) {
          return <span className='text-muted-foreground/60 text-xs'>-</span>
        }
        return (
          <TruncatedCell
            className='max-w-[220px] text-xs'
            tooltipClassName='max-w-sm break-words'
            tooltipContent={userAgent}
          >
            {userAgent}
          </TruncatedCell>
        )
      },
      enableSorting: false,
      size: 220,
    },
  ]
}
