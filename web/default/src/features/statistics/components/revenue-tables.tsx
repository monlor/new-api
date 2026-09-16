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
import { useTranslation } from 'react-i18next'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { revenueProviderLabelKey } from '../constants'
import type { RevenueRecentTopUp, RevenueTopUser } from '../types'

function TablePanel(props: {
  title: string
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='border-b px-4 py-2.5 text-sm font-semibold'>
        {props.title}
      </div>
      <div className='p-3'>
        {props.loading ? (
          <div className='space-y-1.5'>
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className='h-7 w-full' />
            ))}
          </div>
        ) : (
          props.children
        )}
      </div>
    </div>
  )
}

/** Users ranked by total paid amount within the period. */
export function TopRechargeUsersTable(props: {
  data: RevenueTopUser[]
  loading?: boolean
}) {
  const { t } = useTranslation()

  const columns: StaticDataTableColumn<RevenueTopUser>[] = [
    {
      id: 'rank',
      header: '#',
      className: 'w-10',
      cellClassName: 'text-muted-foreground tabular-nums',
      cell: (_row, index) => index + 1,
    },
    {
      id: 'username',
      header: t('Username'),
      cell: (row) => (
        <span className='font-medium'>{row.username || `#${row.user_id}`}</span>
      ),
    },
    {
      id: 'count',
      header: t('Orders'),
      cellClassName: 'tabular-nums',
      cell: (row) => formatNumber(row.count),
    },
    {
      id: 'money',
      header: t('Amount Paid'),
      cellClassName: 'font-medium tabular-nums',
      cell: (row) => formatBillingCurrencyFromUSD(Number(row.money) || 0),
    },
  ]

  return (
    <TablePanel title={t('Top Recharge Users')} loading={props.loading}>
      <StaticDataTable
        columns={columns}
        data={props.data}
        getRowKey={(row) => row.user_id}
        empty={props.data.length === 0}
        emptyContent={t('No recharges in the selected period')}
        tableClassName='text-xs'
      />
    </TablePanel>
  )
}

const STATUS_META: Record<
  string,
  { labelKey: string; variant: 'success' | 'warning' | 'neutral' }
> = {
  success: { labelKey: 'Success', variant: 'success' },
  pending: { labelKey: 'Pending', variant: 'warning' },
}

/** Most recent successful orders within the period. */
export function RecentTopUpsTable(props: {
  data: RevenueRecentTopUp[]
  loading?: boolean
}) {
  const { t } = useTranslation()

  const columns: StaticDataTableColumn<RevenueRecentTopUp>[] = [
    {
      id: 'trade_no',
      header: t('Order Number'),
      cellClassName: 'font-mono text-[11px]',
      cell: (row) => row.trade_no || '-',
    },
    {
      id: 'username',
      header: t('Username'),
      cell: (row) => (
        <span className='font-medium'>{row.username || `#${row.user_id}`}</span>
      ),
    },
    {
      id: 'payment_method',
      header: t('Payment Method'),
      cell: (row) => {
        const labelKey = revenueProviderLabelKey(row.payment_provider)
        if (labelKey) return t(labelKey)
        return row.payment_provider || row.payment_method || '-'
      },
    },
    {
      id: 'money',
      header: t('Amount Paid'),
      cellClassName: 'font-medium tabular-nums',
      cell: (row) => formatBillingCurrencyFromUSD(Number(row.money) || 0),
    },
    {
      id: 'complete_time',
      header: t('Completed At'),
      cellClassName: 'tabular-nums',
      // `complete_time` is 0 on legacy rows; fall back to create_time.
      cell: (row) =>
        formatTimestampToDate(row.complete_time || row.create_time),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (row) => {
        const meta = STATUS_META[row.status]
        return (
          <StatusBadge
            label={meta ? t(meta.labelKey) : row.status}
            variant={meta?.variant ?? 'neutral'}
            copyable={false}
          />
        )
      },
    },
  ]

  return (
    <TablePanel title={t('Recent Recharge Records')} loading={props.loading}>
      <StaticDataTable
        columns={columns}
        data={props.data}
        getRowKey={(row) => row.id}
        empty={props.data.length === 0}
        emptyContent={t('No recharges in the selected period')}
        tableClassName='text-xs'
      />
    </TablePanel>
  )
}
