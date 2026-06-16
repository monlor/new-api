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
import { formatQuota, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { BadgeCell } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  USER_STATUS,
  USER_STATUSES,
  USER_ROLES,
  isUserDeleted,
} from '../constants'
import type { UserSubscriptionBatchMap } from '@/features/subscriptions/types'
import { type User } from '../types'
import { DataTableRowActions } from './data-table-row-actions'

function getSubProgressColor(pct: number): string {
  if (pct >= 90) return '[&_[data-slot=progress-indicator]]:bg-rose-500'
  if (pct >= 70) return '[&_[data-slot=progress-indicator]]:bg-amber-500'
  return '[&_[data-slot=progress-indicator]]:bg-emerald-500'
}

export function useUsersColumns(
  subscriptionMap: UserSubscriptionBatchMap = {}
): ColumnDef<User>[] {
  const { t } = useTranslation()
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label='Select all'
          className='translate-y-[2px]'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label='Select row'
          className='translate-y-[2px]'
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      accessorKey: 'id',
      header: t('ID'),
      cell: ({ row }) => {
        return (
          <TableId value={row.getValue('id') as number} className='w-[60px]' />
        )
      },
      size: 80,
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'username',
      header: t('Username'),
      cell: ({ row }) => {
        const username = row.getValue('username') as string
        const displayName = row.original.display_name
        const remark = row.original.remark

        return (
          <div className='flex min-w-[160px] flex-col gap-1'>
            <div className='flex items-center gap-2'>
              <LongText className='max-w-[140px] font-medium'>
                {username}
              </LongText>
              {remark && (
                <Tooltip>
                  <TooltipTrigger
                    render={<StatusBadge variant='success' copyable={false} />}
                  >
                    <LongText className='max-w-[80px]'>{remark}</LongText>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='text-xs'>{remark}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {displayName && displayName !== username && (
              <LongText className='text-muted-foreground max-w-[180px] text-xs'>
                {displayName}
              </LongText>
            )}
          </div>
        )
      },
      enableHiding: false,
      size: 220,
      meta: { mobileTitle: true },
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const user = row.original
        const requestCount = user.request_count

        const statusConfig = isUserDeleted(user)
          ? USER_STATUSES[USER_STATUS.DELETED]
          : USER_STATUSES[user.status as keyof typeof USER_STATUSES]

        if (!statusConfig) {
          return null
        }

        return (
          <Tooltip>
            <TooltipTrigger render={<div className='-ml-1.5 cursor-help' />}>
              <StatusBadge
                label={t(statusConfig.labelKey)}
                variant={statusConfig.variant}
                copyable={false}
              />
            </TooltipTrigger>
            <TooltipContent>
              <p className='text-xs'>
                {t('Requests:')} {requestCount.toLocaleString()}
              </p>
            </TooltipContent>
          </Tooltip>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(String(row.getValue(id)))
      },
      enableSorting: false,
      size: 120,
      meta: { mobileBadge: true },
    },
    {
      id: 'quota',
      accessorKey: 'quota',
      header: t('Balance'),
      cell: ({ row }) => {
        const remaining = row.original.quota
        if (remaining === 0) {
          return (
            <StatusBadge
              label={t('No Quota')}
              variant='neutral'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        return (
          <span className='text-sm font-medium tabular-nums'>
            {formatQuota(remaining)}
          </span>
        )
      },
      size: 130,
    },
    {
      id: 'used_quota',
      accessorKey: 'used_quota',
      header: t('Used'),
      cell: ({ row }) => {
        const used = row.original.used_quota
        if (used === 0) {
          return <span className='text-muted-foreground text-sm'>-</span>
        }
        return (
          <span className='text-muted-foreground text-sm tabular-nums'>
            {formatQuota(used)}
          </span>
        )
      },
      size: 130,
    },
    {
      id: 'subscription_usage',
      header: t('Subscription Usage'),
      cell: ({ row }) => {
        const sub = subscriptionMap[String(row.original.id)]
        if (!sub) {
          return <span className='text-muted-foreground text-sm'>-</span>
        }
        const total = Number(sub.amount_total || 0)
        const used = Number(sub.amount_used || 0)
        const remaining = Math.max(0, total - used)
        const pct = total > 0 ? Math.round((used / total) * 100) : 0
        const now = Date.now() / 1000
        const isExpired = sub.end_time > 0 && sub.end_time < now

        return (
          <Tooltip>
            <TooltipTrigger
              render={<div className='w-[160px] cursor-help space-y-1' />}
            >
              {total > 0 ? (
                <>
                  <div className='flex justify-between text-xs'>
                    <span className='font-medium tabular-nums'>
                      {formatQuota(used)}
                    </span>
                    <span className='text-muted-foreground tabular-nums'>
                      {formatQuota(total)}
                    </span>
                  </div>
                  <Progress
                    value={pct}
                    className={cn('h-1.5', getSubProgressColor(pct))}
                  />
                </>
              ) : (
                <StatusBadge
                  label={t('Unlimited')}
                  variant='info'
                  copyable={false}
                  className='-ml-1.5'
                />
              )}
            </TooltipTrigger>
            <TooltipContent>
              <div className='space-y-1 text-xs'>
                <div>
                  {t('Used:')} {formatQuota(used)}
                </div>
                {total > 0 && (
                  <>
                    <div>
                      {t('Remaining:')} {formatQuota(remaining)}
                    </div>
                    <div>
                      {t('Total:')} {formatQuota(total)}
                    </div>
                    <div>
                      {t('Percentage:')} {pct}%
                    </div>
                  </>
                )}
                <div>
                  {isExpired ? t('Expired') : t('Active')}
                  {' · '}
                  {t('Until')}{' '}
                  {new Date(sub.end_time * 1000).toLocaleDateString()}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        )
      },
      size: 180,
      enableSorting: false,
    },
    {
      accessorKey: 'group',
      header: t('Group'),
      cell: ({ row }) => {
        const group = row.getValue('group') as string
        return (
          <BadgeCell>
            <GroupBadge group={group} />
          </BadgeCell>
        )
      },
      filterFn: (row, id, value) => {
        const group = String(row.getValue(id) || t('User Group')).toLowerCase()
        const searchValue = String(value).toLowerCase()
        return group.includes(searchValue)
      },
      size: 140,
    },
    {
      accessorKey: 'role',
      header: t('Role'),
      cell: ({ row }) => {
        const roleValue = row.getValue('role') as number
        const roleConfig = USER_ROLES[roleValue as keyof typeof USER_ROLES]

        if (!roleConfig) {
          return null
        }

        return (
          <div className='flex items-center gap-x-2'>
            {roleConfig.icon && (
              <roleConfig.icon size={16} className='text-muted-foreground' />
            )}
            <span className='text-sm'>{t(roleConfig.labelKey)}</span>
          </div>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(String(row.getValue(id)))
      },
      enableSorting: false,
      size: 120,
    },
    {
      id: 'invite_info',
      header: t('Invite Info'),
      cell: ({ row }) => {
        const user = row.original
        const affCount = user.aff_count || 0
        const affHistoryQuota = user.aff_history_quota || 0
        const inviterId = user.inviter_id || 0

        return (
          <div className='flex max-w-full min-w-0 flex-wrap items-center gap-1 overflow-hidden'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <StatusBadge
                    label={`${t('Invited')}: ${affCount}`}
                    variant='neutral'
                    copyable={false}
                    className='cursor-help'
                  />
                }
              />
              <TooltipContent>
                <p className='text-xs'>{t('Number of users invited')}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <StatusBadge
                    label={`${t('Revenue')}: ${formatQuota(affHistoryQuota)}`}
                    variant='neutral'
                    copyable={false}
                    className='cursor-help'
                  />
                }
              />
              <TooltipContent>
                <p className='text-xs'>{t('Total invitation revenue')}</p>
              </TooltipContent>
            </Tooltip>
            {inviterId > 0 && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <StatusBadge
                      label={`${t('Inviter')}: ${inviterId}`}
                      variant='neutral'
                      copyable={false}
                      className='cursor-help'
                    />
                  }
                />
                <TooltipContent>
                  <p className='text-xs'>
                    {t('Invited by user ID')} {inviterId}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {inviterId === 0 && (
              <StatusBadge
                label={t('No Inviter')}
                variant='neutral'
                copyable={false}
              />
            )}
          </div>
        )
      },
      size: 240,
      enableSorting: false,
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'created_at',
      header: t('Created At'),
      cell: ({ row }) => {
        const ts = row.getValue('created_at') as number | undefined
        return (
          <span className='text-muted-foreground text-sm'>
            {ts ? formatTimestamp(ts) : '-'}
          </span>
        )
      },
      size: 180,
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'last_login_at',
      header: t('Last Login'),
      cell: ({ row }) => {
        const ts = row.getValue('last_login_at') as number | undefined
        return (
          <span className='text-muted-foreground text-sm'>
            {ts ? formatTimestamp(ts) : '-'}
          </span>
        )
      },
      size: 180,
      meta: { mobileHidden: true },
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      cell: ({ row }) => <DataTableRowActions row={row} />,
      meta: { pinned: 'right' as const },
    },
  ]
}
