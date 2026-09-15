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
import { useEffect, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { DateTimePicker } from '@/components/datetime-picker'
import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { updateUserSubscription } from '../api'
import {
  userSubscriptionEditSchema,
  type UserSubscription,
  type UserSubscriptionEditForm as FormValues,
} from '../types'

interface Props {
  subscription: UserSubscription
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function toFormValues(sub: UserSubscription): FormValues {
  // Statuses outside the editable enum fall back to 'active' so the Select
  // always has a valid value; the admin then picks explicitly.
  const status =
    sub.status === 'expired' || sub.status === 'cancelled'
      ? sub.status
      : 'active'
  const totalUnits = Number(sub.amount_total || 0)
  const usedUnits = Number(sub.amount_used || 0)
  const usedPercent =
    totalUnits > 0
      ? Math.round((usedUnits / totalUnits) * 10000) / 100
      : 0
  return {
    amount_used_percent: Math.min(100, Math.max(0, usedPercent)),
    amount_total: Math.round(quotaUnitsToDollars(totalUnits) * 100) / 100,
    end_time: Number(sub.end_time || 0),
    status,
  }
}

export function UserSubscriptionEditForm({
  subscription,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(
      userSubscriptionEditSchema
    ) as unknown as Resolver<FormValues>,
    defaultValues: toFormValues(subscription),
  })

  // Subscribe during render — RHF only tracks formState fields that were read.
  const { dirtyFields } = form.formState

  useEffect(() => {
    if (open) {
      form.reset(toFormValues(subscription))
    }
  }, [open, subscription, form])

  const statusOptions = [
    { value: 'active', label: t('Active') },
    { value: 'expired', label: t('Expired') },
    ...(subscription.status === 'cancelled'
      ? [{ value: 'cancelled', label: t('Invalidated') }]
      : []),
  ]

  const watchedTotal = form.watch('amount_total')

  const parseCurrencyAmount = (raw: string) => {
    const n = parseFloat(raw)
    return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100
  }

  const parsePercent = (raw: string) => {
    const n = parseFloat(raw)
    if (Number.isNaN(n)) return 0
    return Math.min(100, Math.max(0, Math.round(n * 100) / 100))
  }

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      const totalUnits = parseQuotaFromDollars(values.amount_total)
      const percentDirty = Boolean(dirtyFields.amount_used_percent)
      const totalDirty = Boolean(dirtyFields.amount_total)
      // Reconstruct used only when the admin actually edited percent/total.
      // 2-decimal percent cannot round-trip raw units (e.g. 25530/5e8 → 0.01
      // → 50000), so never dirty-compare reconstructed used vs the loaded row.
      const reconstructedUsed =
        totalUnits > 0
          ? Math.round((totalUnits * values.amount_used_percent) / 100)
          : undefined

      const payload: {
        amount_used?: number
        amount_total?: number
        end_time?: number
        status?: string
      } = {}

      if (totalDirty) {
        payload.amount_total = totalUnits
        if (reconstructedUsed !== undefined) {
          payload.amount_used = reconstructedUsed
        }
      } else if (percentDirty && reconstructedUsed !== undefined) {
        payload.amount_used = reconstructedUsed
      }

      if (dirtyFields.end_time) {
        payload.end_time = values.end_time
      }
      if (dirtyFields.status) {
        payload.status = values.status
      }

      if (Object.keys(payload).length === 0) {
        toast.info(t('No changes to save'))
        return
      }

      const res = await updateUserSubscription(subscription.id, payload)
      if (res.success) {
        toast.success(t('Update succeeded'))
        onOpenChange(false)
        onSuccess()
      } else {
        toast.error(res.message || t('Update failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) form.reset()
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[480px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('Edit Subscription')}</SheetTitle>
          <SheetDescription>
            {t(
              'Quota and dates are overwritten directly. Setting a subscription inactive or in the past will also revert the upgrade group, same as Invalidate.'
            )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='user-subscription-edit-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className={sideDrawerFormClassName()}
          >
            <FormField
              control={form.control}
              name='amount_total'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Amount Total')} ({getCurrencyLabel()})
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      step='0.01'
                      min={0}
                      onChange={(e) =>
                        field.onChange(parseCurrencyAmount(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormDescription>{t('0 means unlimited')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='amount_used_percent'
              render={({ field }) => {
                const isUnlimited = Number(watchedTotal || 0) <= 0
                return (
                  <FormItem>
                    <FormLabel>{t('Amount Used')} (%)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        step='0.01'
                        min={0}
                        max={100}
                        disabled={isUnlimited}
                        onChange={(e) =>
                          field.onChange(parsePercent(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {isUnlimited
                        ? t('Percentage does not apply to unlimited plans')
                        : t('Percentage of Amount Total already used')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )
              }}
            />

            <FormField
              control={form.control}
              name='end_time'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('End Time')}</FormLabel>
                  <FormControl>
                    <DateTimePicker
                      value={
                        field.value ? new Date(field.value * 1000) : undefined
                      }
                      onChange={(date) =>
                        field.onChange(
                          date ? Math.floor(date.getTime() / 1000) : 0
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='status'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Status')}</FormLabel>
                  <Select
                    items={statusOptions}
                    value={field.value}
                    onValueChange={(v) => v !== null && field.onChange(v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {statusOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='user-subscription-edit-form'
            type='submit'
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
