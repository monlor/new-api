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
import { type Table } from '@tanstack/react-table'
import { Power, PowerOff, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { batchManageUsers } from '../api'
import { ERROR_MESSAGES } from '../constants'
import { type User, type BatchUserAction } from '../types'
import { useUsers } from './users-provider'

interface DataTableBulkActionsProps {
  table: Table<User>
}

export function DataTableBulkActions({ table }: DataTableBulkActionsProps) {
  const { t } = useTranslation()
  const { triggerRefresh } = useUsers()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const selectedRows = table.getFilteredSelectedRowModel().rows
  const selectedIds = selectedRows.reduce<number[]>((ids, row) => {
    const id = (row.original as User).id

    if (typeof id === 'number') {
      ids.push(id)
    }

    return ids
  }, [])

  const successMessage = (action: BatchUserAction, count: number) => {
    switch (action) {
      case 'enable':
        return t('Successfully enabled {{count}} user(s)', { count })
      case 'disable':
        return t('Successfully disabled {{count}} user(s)', { count })
      case 'delete':
        return t('Successfully deleted {{count}} user(s)', { count })
    }
  }

  const runBatch = async (action: BatchUserAction) => {
    if (selectedIds.length === 0 || isProcessing) return

    setIsProcessing(true)
    try {
      const result = await batchManageUsers(selectedIds, action)

      if (!result.success || !result.data) {
        toast.error(result.message || t('Failed to {{action}} users', { action }))
        return
      }

      const { succeeded, failed, errors } = result.data

      if (succeeded > 0) {
        toast.success(successMessage(action, succeeded))
      }

      if (failed > 0) {
        const detail = errors?.length ? errors.slice(0, 3).join('; ') : ''
        toast.warning(
          detail
            ? t('Failed for {{count}} user(s): {{detail}}', {
                count: failed,
                detail,
              })
            : t('Failed for {{count}} user(s)', { count: failed })
        )
      }

      table.resetRowSelection()
      triggerRefresh()
    } catch (_error) {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDeleteAll = async () => {
    await runBatch('delete')
    setShowDeleteConfirm(false)
  }

  return (
    <>
      <BulkActionsToolbar table={table} entityName='user'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                onClick={() => runBatch('enable')}
                disabled={isProcessing}
                className='size-8'
                aria-label={t('Enable selected users')}
                title={t('Enable selected users')}
              />
            }
          >
            <Power />
            <span className='sr-only'>{t('Enable selected users')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Enable selected users')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                onClick={() => runBatch('disable')}
                disabled={isProcessing}
                className='size-8'
                aria-label={t('Disable selected users')}
                title={t('Disable selected users')}
              />
            }
          >
            <PowerOff />
            <span className='sr-only'>{t('Disable selected users')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Disable selected users')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='destructive'
                size='icon'
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isProcessing}
                className='size-8'
                aria-label={t('Delete selected users')}
                title={t('Delete selected users')}
              />
            }
          >
            <Trash2 />
            <span className='sr-only'>{t('Delete selected users')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Delete selected users')}</p>
          </TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('Delete {{count}} user(s)?', { count: selectedIds.length })}
        desc={t(
          'You are about to delete {{count}} user(s). This action cannot be undone.',
          { count: selectedIds.length }
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={isProcessing}
        handleConfirm={handleDeleteAll}
      />
    </>
  )
}
