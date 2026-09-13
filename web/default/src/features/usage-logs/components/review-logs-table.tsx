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
import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  formatLogQuota,
  formatTimestampToDate,
  formatTokens,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/use-admin'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DataTablePage,
  DataTableRow,
  useDataTable,
} from '@/components/data-table'
import { DateTimePicker } from '@/components/datetime-picker'
import {
  deleteContentReviewLogs,
  getContentReviewLogs,
  getContentReviewLogsStat,
} from '../api'
import {
  CONTENT_REVIEW_DECISIONS,
  DEFAULT_CONTENT_REVIEW_STATS,
  DEFAULT_LOGS_DATA,
} from '../constants'
import { getDefaultTimeRange } from '../lib/utils'
import type { ContentReviewLogFilters } from '../types'
import { useReviewLogsColumns } from './columns/review-logs-columns'
import { CompactDateTimeRangePicker } from './compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from './logs-filter-toolbar'

const route = getRouteApi('/_authenticated/usage-logs/$section')

function timestampToSeconds(ms: number) {
  return Math.floor(ms / 1000)
}

export function ReviewLogsTable() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const searchParams = route.useSearch()
  const columns = useReviewLogsColumns()

  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 100 },
    globalFilter: { enabled: false },
    columnFilters: [
      { columnId: 'decision', searchKey: 'decision', type: 'string' as const },
      { columnId: 'review_model', searchKey: 'model', type: 'string' as const },
      { columnId: 'username', searchKey: 'username', type: 'string' as const },
      { columnId: 'channel', searchKey: 'channel', type: 'string' as const },
      {
        columnId: 'request_id',
        searchKey: 'requestId',
        type: 'string' as const,
      },
    ],
  })

  const [filters, setFilters] = useState<ContentReviewLogFilters>(() => {
    const { start, end } = getDefaultTimeRange()
    return {
      startTime: searchParams.startTime
        ? new Date(searchParams.startTime)
        : start,
      endTime: searchParams.endTime ? new Date(searchParams.endTime) : end,
      channel: searchParams.channel || undefined,
      model: searchParams.model || undefined,
      username: searchParams.username || undefined,
      requestId: searchParams.requestId || undefined,
      decision: searchParams.decision || undefined,
    }
  })
  const [decision, setDecision] = useState(searchParams.decision || 'all')
  const [purgeDate, setPurgeDate] = useState<Date | undefined>(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date
  })
  const [purgeScope, setPurgeScope] = useState<'pass' | 'all'>('pass')
  const [showConfirm, setShowConfirm] = useState(false)
  const [isCleaning, setIsCleaning] = useState(false)

  const apiParams = useMemo(
    () => ({
      p: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
      username: searchParams.username || undefined,
      model_name: searchParams.model || undefined,
      channel: searchParams.channel
        ? Number(searchParams.channel) || undefined
        : undefined,
      request_id: searchParams.requestId || undefined,
      decision: searchParams.decision || undefined,
      start_timestamp: searchParams.startTime
        ? timestampToSeconds(searchParams.startTime)
        : timestampToSeconds(getDefaultTimeRange().start.getTime()),
      end_timestamp: searchParams.endTime
        ? timestampToSeconds(searchParams.endTime)
        : timestampToSeconds(getDefaultTimeRange().end.getTime()),
    }),
    [pagination.pageIndex, pagination.pageSize, searchParams]
  )

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['content-review-logs', apiParams, t],
    queryFn: async () => {
      const result = await getContentReviewLogs(apiParams)
      if (!result?.success) {
        toast.error(result?.message || t('Failed to load logs'))
        return DEFAULT_LOGS_DATA
      }
      return result.data || DEFAULT_LOGS_DATA
    },
    enabled: isAdmin,
    placeholderData: (previousData) => previousData,
  })

  const statsParams = useMemo(
    () => ({
      username: apiParams.username,
      model_name: apiParams.model_name,
      channel: apiParams.channel,
      request_id: apiParams.request_id,
      decision: apiParams.decision,
      start_timestamp: apiParams.start_timestamp,
      end_timestamp: apiParams.end_timestamp,
    }),
    [apiParams]
  )

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['content-review-logs-stat', statsParams],
    queryFn: async () => {
      const result = await getContentReviewLogsStat(statsParams)
      return result.success
        ? result.data || DEFAULT_CONTENT_REVIEW_STATS
        : DEFAULT_CONTENT_REVIEW_STATS
    },
    enabled: isAdmin,
    placeholderData: (previousData) => previousData,
  })

  const logs = data?.items || []
  const { table } = useDataTable({
    data: logs as unknown as Record<string, unknown>[],
    columns: columns as ColumnDef<Record<string, unknown>>[],
    columnFilters,
    pagination,
    enableRowSelection: false,
    onPaginationChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total || 0,
    ensurePageInRange,
  })

  const handleApply = useCallback(() => {
    navigate({
      to: '/usage-logs/$section',
      params: { section: 'review' },
      search: {
        page: 1,
        startTime: filters.startTime?.getTime(),
        endTime: filters.endTime?.getTime(),
        model: filters.model,
        username: filters.username,
        channel: filters.channel,
        requestId: filters.requestId,
        decision: decision === 'all' ? undefined : decision,
      },
    })
    queryClient.invalidateQueries({ queryKey: ['content-review-logs'] })
    queryClient.invalidateQueries({ queryKey: ['content-review-logs-stat'] })
  }, [decision, filters, navigate, queryClient])

  const handleReset = useCallback(() => {
    const { start, end } = getDefaultTimeRange()
    setFilters({ startTime: start, endTime: end })
    setDecision('all')
    navigate({
      to: '/usage-logs/$section',
      params: { section: 'review' },
      search: {
        page: 1,
        startTime: start.getTime(),
        endTime: end.getTime(),
      },
    })
  }, [navigate])

  const handleClean = async () => {
    if (!purgeDate) {
      toast.error(t('Select a timestamp before clearing logs.'))
      return
    }
    setIsCleaning(true)
    try {
      const res = await deleteContentReviewLogs({
        targetTimestamp: Math.floor(purgeDate.getTime() / 1000),
        decision: purgeScope,
      })
      if (!res.success) {
        throw new Error(res.message || t('Failed to clean logs'))
      }
      const count = res.data ?? 0
      toast.success(
        count > 0
          ? t('{{count}} log entries removed.', { count })
          : t('No log entries matched the selected time.')
      )
      queryClient.invalidateQueries({ queryKey: ['content-review-logs'] })
      queryClient.invalidateQueries({ queryKey: ['content-review-logs-stat'] })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to clean logs')
      )
    } finally {
      setIsCleaning(false)
      setShowConfirm(false)
    }
  }

  const hasActiveFilters =
    !!filters.model ||
    !!filters.username ||
    !!filters.channel ||
    !!filters.requestId ||
    decision !== 'all'

  const currentStats = stats || DEFAULT_CONTENT_REVIEW_STATS
  const statsBar = statsLoading ? (
    <div className='flex items-center gap-2'>
      <Skeleton className='h-7 w-[150px] rounded-md' />
      <Skeleton className='h-7 w-[120px] rounded-md' />
    </div>
  ) : (
    <div className='flex flex-wrap items-center gap-2'>
      <StatBadge
        label={t('Total')}
        value={currentStats.total}
        accent='bg-sky-500'
      />
      <StatBadge
        label={t('Pass')}
        value={currentStats.pass}
        accent='bg-emerald-500'
      />
      <StatBadge
        label={t('Flagged')}
        value={currentStats.flag}
        accent='bg-amber-500'
      />
      <StatBadge
        label={t('Blocked')}
        value={currentStats.block}
        accent='bg-rose-500'
      />
      <StatBadge
        label={t('Error')}
        value={currentStats.error}
        accent='bg-zinc-500'
      />
      <StatBadge
        label={t('Tokens')}
        value={formatTokens(
          currentStats.prompt_tokens + currentStats.completion_tokens
        )}
        accent='bg-violet-500'
      />
      <StatBadge
        label={t('Estimated Cost')}
        value={formatLogQuota(currentStats.estimated_quota)}
        accent='bg-orange-500'
      />
      {currentStats.sampled ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='border-border/60 bg-muted/25 text-muted-foreground inline-flex h-7 items-center rounded-md border px-2.5 text-xs shadow-xs' />
            }
          >
            {t('Sampled')}
          </TooltipTrigger>
          <TooltipContent>
            {(currentStats.pass_sample_rate ?? 0) > 0
              ? t(
                  'Pass totals and related cost are estimated from the sample rate. Flag, block, and error counts are complete.'
                )
              : t(
                  'Pass reviews are not stored. Flag, block, and error counts are complete.'
                )}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )

  const decisionItems = useMemo(
    () =>
      CONTENT_REVIEW_DECISIONS.map((item) => ({
        value: item.value,
        label: t(item.label),
      })),
    [t]
  )

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns as ColumnDef<Record<string, unknown>>[]}
        isLoading={isLoading || (isFetching && !data)}
        isFetching={isFetching}
        emptyTitle={t('No Logs Found')}
        emptyDescription={t(
          'No content review logs yet. They appear after review is enabled.'
        )}
        skeletonKeyPrefix='review-log-skeleton'
        applyHeaderSize
        tableClassName='[&_[data-slot=table]]:text-[13px]'
        renderRow={(row) => (
          <DataTableRow
            key={row.id}
            row={row}
            className='transition-colors'
            getColumnClassName={() => 'py-2'}
          />
        )}
        toolbar={
          <LogsFilterToolbar
            table={table}
            hasActiveFilters={hasActiveFilters}
            stats={statsBar}
            onReset={handleReset}
            onSearch={handleApply}
            primaryFilters={
              <>
                <LogsFilterField wide>
                  <CompactDateTimeRangePicker
                    start={filters.startTime}
                    end={filters.endTime}
                    onChange={({ start, end }) =>
                      setFilters((prev) => ({
                        ...prev,
                        startTime: start,
                        endTime: end,
                      }))
                    }
                  />
                </LogsFilterField>
                <LogsFilterField>
                  <Select
                    items={decisionItems}
                    value={decision}
                    onValueChange={(value) =>
                      setDecision(value === null ? 'all' : value)
                    }
                  >
                    <SelectTrigger className='h-8 w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {decisionItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </LogsFilterField>
                <LogsFilterField>
                  <LogsFilterInput
                    placeholder={t('Review model')}
                    value={filters.model || ''}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, model: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApply()
                    }}
                  />
                </LogsFilterField>
              </>
            }
            advancedFilters={
              <>
                <LogsFilterField>
                  <LogsFilterInput
                    placeholder={t('Username')}
                    value={filters.username || ''}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        username: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApply()
                    }}
                  />
                </LogsFilterField>
                <LogsFilterField>
                  <LogsFilterInput
                    placeholder={t('Channel ID')}
                    value={filters.channel || ''}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        channel: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApply()
                    }}
                  />
                </LogsFilterField>
                <LogsFilterField>
                  <LogsFilterInput
                    placeholder={t('Request ID')}
                    value={filters.requestId || ''}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        requestId: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApply()
                    }}
                  />
                </LogsFilterField>
                <div className='flex flex-wrap items-end gap-2 sm:col-span-2'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setShowConfirm(true)}
                  >
                    {t('Clean logs')}
                  </Button>
                </div>
              </>
            }
          />
        }
      />
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Confirm log cleanup')}</AlertDialogTitle>
            <AlertDialogDescription>
              {purgeDate
                ? t(
                    'This will permanently remove review logs created before {{date}}.',
                    {
                      date: formatTimestampToDate(
                        purgeDate.getTime(),
                        'milliseconds'
                      ),
                    }
                  )
                : t(
                    'This will permanently remove log entries before the selected timestamp.'
                  )}{' '}
              {t('This action cannot be undone.')}
            </AlertDialogDescription>
            <div className='space-y-3'>
              <DateTimePicker value={purgeDate} onChange={setPurgeDate} />
              <Select
                items={[
                  { value: 'pass', label: t('Pass logs only') },
                  { value: 'all', label: t('All review logs') },
                ]}
                value={purgeScope}
                onValueChange={(value) =>
                  setPurgeScope(value === 'all' ? 'all' : 'pass')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value='pass'>{t('Pass logs only')}</SelectItem>
                    <SelectItem value='all'>{t('All review logs')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCleaning}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleClean} disabled={isCleaning}>
              {isCleaning ? t('Cleaning...') : t('Delete logs')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function StatBadge(props: {
  label: string
  value: string | number
  accent: string
}) {
  return (
    <span className='border-border/60 bg-muted/25 inline-flex h-7 items-center gap-2 rounded-md border px-2.5 text-xs shadow-xs'>
      <span className={cn('h-3.5 w-0.5 rounded-full', props.accent)} />
      <span className='text-muted-foreground'>{props.label}</span>
      <span className='text-foreground/85 font-mono font-semibold tabular-nums'>
        {props.value}
      </span>
    </span>
  )
}
