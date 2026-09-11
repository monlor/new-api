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
import { useState, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatTimestamp } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/status-badge'
import { manageUser } from '../api'
import { ERROR_MESSAGES, isHighRiskUser, isUserDeleted } from '../constants'
import { getUserActionMessage } from '../lib'
import { type User } from '../types'
import { useUsers } from './users-provider'

export function HighRiskBadge({ user }: { user: User }) {
  const { t } = useTranslation()
  const { triggerRefresh } = useUsers()
  const [pending, setPending] = useState(false)

  if (!isHighRiskUser(user)) {
    return <span className='text-muted-foreground'>-</span>
  }

  const handleClear = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (pending) return
    setPending(true)
    try {
      const result = await manageUser(user.id, 'clear_high_risk')
      if (result.success) {
        toast.success(t(getUserActionMessage('clear_high_risk')))
        triggerRefresh()
        return
      }
      toast.error(result.message || t('Failed to clear high-risk flag'))
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    }
    setPending(false)
  }

  return (
    <div className='flex items-center gap-1'>
      <Tooltip>
        <TooltipTrigger
          render={<StatusBadge variant='danger' copyable={false} />}
        >
          {t('High risk')}
        </TooltipTrigger>
        <TooltipContent>
          <p className='text-xs'>
            {user.high_risk_reason || t('High-risk user')}
            {user.high_risk_at ? ` · ${formatTimestamp(user.high_risk_at)}` : ''}
          </p>
        </TooltipContent>
      </Tooltip>
      {!isUserDeleted(user) && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='text-destructive hover:text-destructive'
                disabled={pending}
                aria-label={t('Clear high-risk flag')}
                onClick={handleClear}
              />
            }
          >
            <X />
            <span className='sr-only'>{t('Clear high-risk flag')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p className='text-xs'>{t('Clear high-risk flag')}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
