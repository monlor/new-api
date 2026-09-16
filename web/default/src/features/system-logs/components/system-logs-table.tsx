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
import { useTableUrlState } from '@/hooks/use-table-url-state'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTablePage, DataTableRow, useDataTable } from '@/components/data-table'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'
import { getDefaultTimeRange } from '@/features/usage-logs/lib/utils'
import { getSystemLogs } from '../api'
import {
  DEFAULT_SYSTEM_LOGS_DATA,
  SYSTEM_LOG_TYPE_ALL_VALUE,
  SYSTEM_LOG_TYPE_FILTERS,
} from '../constants'
import type { SystemLogFilters } from '../types'
import { useSystemLogsColumns } from './system-logs-columns'

const route = getRouteApi('/_authenticated/system-logs/')

function timestampToSeconds(ms: number) {
  return Math.floor(ms / 1000)
}

export function SystemLogsTable() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const searchParams = route.useSearch()
  const columns = useSystemLogsColumns()

  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: {
      pageKey: 'page',
      pageSizeKey: 'pageSize',
      defaultPage: 1,
      defaultPageSize: 20,
    },
    globalFilter: { enabled: false },
    columnFilters: [
      { columnId: 'type', searchKey: 'type', type: 'string' as const },
      { columnId: 'username', searchKey: 'username', type: 'string' as const },
      { columnId: 'ip', searchKey: 'ip', type: 'string' as const },
      { columnId: 'group', searchKey: 'group', type: 'string' as const },
      { columnId: 'model_name', searchKey: 'model', type: 'string' as const },
    ],
  })

  const [filters, setFilters] = useState<SystemLogFilters>(() => {
    const { start, end } = getDefaultTimeRange()
    return {
      startTime: searchParams.startTime
        ? new Date(searchParams.startTime)
        : start,
      endTime: searchParams.endTime ? new Date(searchParams.endTime) : end,
      username: searchParams.username || undefined,
      ip: searchParams.ip || undefined,
      group: searchParams.group || undefined,
      modelName: searchParams.model || undefined,
    }
  })
  const [logType, setLogType] = useState(
    searchParams.type || SYSTEM_LOG_TYPE_ALL_VALUE
  )

  const apiParams = useMemo(
    () => ({
      p: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
      type:
        searchParams.type && searchParams.type !== SYSTEM_LOG_TYPE_ALL_VALUE
          ? Number(searchParams.type)
          : undefined,
      username: searchParams.username || undefined,
      ip: searchParams.ip || undefined,
      group: searchParams.group || undefined,
      model_name: searchParams.model || undefined,
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
    queryKey: ['system-logs', apiParams, t],
    queryFn: async () => {
      const result = await getSystemLogs(apiParams)
      if (!result?.success) {
        toast.error(result?.message || t('Failed to load logs'))
        return DEFAULT_SYSTEM_LOGS_DATA
      }
      return result.data || DEFAULT_SYSTEM_LOGS_DATA
    },
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
      to: '/system-logs',
      search: {
        page: 1,
        startTime: filters.startTime?.getTime(),
        endTime: filters.endTime?.getTime(),
        username: filters.username,
        ip: filters.ip,
        group: filters.group,
        model: filters.modelName,
        type: logType === SYSTEM_LOG_TYPE_ALL_VALUE ? undefined : logType,
      },
    })
    queryClient.invalidateQueries({ queryKey: ['system-logs'] })
  }, [filters, logType, navigate, queryClient])

  const handleReset = useCallback(() => {
    const { start, end } = getDefaultTimeRange()
    setFilters({ startTime: start, endTime: end })
    setLogType(SYSTEM_LOG_TYPE_ALL_VALUE)
    navigate({
      to: '/system-logs',
      search: {
        page: 1,
        startTime: start.getTime(),
        endTime: end.getTime(),
      },
    })
    queryClient.invalidateQueries({ queryKey: ['system-logs'] })
  }, [navigate, queryClient])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleApply()
    },
    [handleApply]
  )

  const logTypeItems = useMemo(
    () =>
      SYSTEM_LOG_TYPE_FILTERS.map((type) => ({
        value: type.value,
        label: t(type.label),
      })),
    [t]
  )

  const hasActiveFilters =
    !!filters.username ||
    !!filters.ip ||
    !!filters.group ||
    !!filters.modelName ||
    logType !== SYSTEM_LOG_TYPE_ALL_VALUE

  return (
    <DataTablePage
      table={table}
      columns={columns as ColumnDef<Record<string, unknown>>[]}
      isLoading={isLoading || (isFetching && !data)}
      isFetching={isFetching}
      emptyTitle={t('No System Logs Found')}
      emptyDescription={t(
        'No system logs available. Logs will appear here as system events occur.'
      )}
      skeletonKeyPrefix='system-log-skeleton'
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
                  items={logTypeItems}
                  value={logType}
                  onValueChange={(value) =>
                    setLogType(value ?? SYSTEM_LOG_TYPE_ALL_VALUE)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {logTypeItems.map((item) => (
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
                  placeholder={t('Username')}
                  value={filters.username || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  onKeyDown={handleKeyDown}
                />
              </LogsFilterField>
            </>
          }
          advancedFilters={
            <>
              <LogsFilterField>
                <LogsFilterInput
                  placeholder={t('IP Address')}
                  value={filters.ip || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, ip: e.target.value }))
                  }
                  onKeyDown={handleKeyDown}
                />
              </LogsFilterField>
              <LogsFilterField>
                <LogsFilterInput
                  placeholder={t('Group')}
                  value={filters.group || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, group: e.target.value }))
                  }
                  onKeyDown={handleKeyDown}
                />
              </LogsFilterField>
              <LogsFilterField>
                <LogsFilterInput
                  placeholder={t('Model Name')}
                  value={filters.modelName || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      modelName: e.target.value,
                    }))
                  }
                  onKeyDown={handleKeyDown}
                />
              </LogsFilterField>
            </>
          }
        />
      }
    />
  )
}

