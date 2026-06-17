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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { syncSubscriptionPlan } from '../../api'
import { useSubscriptions } from '../subscriptions-provider'

export function SyncPlanDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useSubscriptions()
  const [loading, setLoading] = useState(false)
  const [usedQuotaMode, setUsedQuotaMode] = useState<'keep' | 'proportional'>(
    'keep'
  )

  if (open !== 'force-sync' || !currentRow) return null

  const handleConfirm = async () => {
    setLoading(true)
    try {
      const res = await syncSubscriptionPlan(currentRow.plan.id, usedQuotaMode)
      if (res.success) {
        toast.success(
          t('Synced {{count}} subscriptions', { count: res.data?.count ?? 0 })
        )
        triggerRefresh()
        setOpen(null)
      } else {
        toast.error(res.message ?? t('Operation failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(v) => !v && setOpen(null)}
      title={t('Force Sync')}
      desc={t(
        'This will sync the current plan quota and reset period to all active subscribers of "{{name}}". This action cannot be undone.',
        { name: currentRow.plan.title }
      )}
      handleConfirm={handleConfirm}
      isLoading={loading}
      confirmText={t('Sync')}
    >
      <div className='mt-2 space-y-3'>
        <p className='text-muted-foreground text-sm'>
          {t('How to handle used quota')}
        </p>
        <RadioGroup
          value={usedQuotaMode}
          onValueChange={(v) =>
            setUsedQuotaMode(v as 'keep' | 'proportional')
          }
          className='space-y-2'
        >
          <div className='flex items-start gap-2'>
            <RadioGroupItem value='keep' id='sync-keep' className='mt-0.5' />
            <Label htmlFor='sync-keep' className='cursor-pointer space-y-0.5'>
              <div>{t('Keep unchanged')}</div>
              <div className='text-muted-foreground text-xs font-normal'>
                {t('Do not modify the used quota of existing subscribers')}
              </div>
            </Label>
          </div>
          <div className='flex items-start gap-2'>
            <RadioGroupItem
              value='proportional'
              id='sync-proportional'
              className='mt-0.5'
            />
            <Label
              htmlFor='sync-proportional'
              className='cursor-pointer space-y-0.5'
            >
              <div>{t('Proportional adjustment')}</div>
              <div className='text-muted-foreground text-xs font-normal'>
                {t(
                  'Scale used quota proportionally to the new total quota (usedNew = usedOld × newTotal / oldTotal)'
                )}
              </div>
            </Label>
          </div>
        </RadioGroup>
      </div>
    </ConfirmDialog>
  )
}
