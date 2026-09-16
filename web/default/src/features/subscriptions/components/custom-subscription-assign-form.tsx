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
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Sparkles } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
import { createUserSubscription } from '../api'
import { getDurationUnitOptions } from '../constants'
import { useModelOptions } from '../lib'
import { PlanModelsField } from './plan-models-field'

const customAssignSchema = z.object({
  custom_name: z.string().optional(),
  duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
  duration_value: z.coerce.number().min(1),
  custom_seconds: z.coerce.number().min(0),
  allowed_models: z.string().optional(),
  // Edited as a display-currency amount (USD/CNY), converted to raw quota
  // units on submit — same convention as the plan editor.
  total_amount: z.coerce.number().min(0),
})

type CustomAssignValues = z.infer<typeof customAssignSchema>

const DEFAULTS: CustomAssignValues = {
  custom_name: '',
  duration_unit: 'month',
  duration_value: 1,
  custom_seconds: 0,
  allowed_models: '',
  total_amount: 0,
}

interface Props {
  userId: number
  onSuccess: () => void | Promise<void>
}

/**
 * Assigns a standalone subscription with no plan behind it (plan_id = 0).
 * Admin-assigned subscriptions are always consumed before every other source.
 */
export function CustomSubscriptionAssignForm(props: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const modelOptions = useModelOptions()
  const durationUnitOpts = getDurationUnitOptions(t)

  const form = useForm<CustomAssignValues>({
    resolver: zodResolver(
      customAssignSchema
    ) as unknown as Resolver<CustomAssignValues>,
    defaultValues: DEFAULTS,
  })

  const durationUnit = form.watch('duration_unit')

  const onSubmit = async (values: CustomAssignValues) => {
    if (values.duration_unit === 'custom' && values.custom_seconds <= 0) {
      form.setError('custom_seconds', {
        message: t('Custom duration must be greater than 0 seconds'),
      })
      return
    }
    setIsSubmitting(true)
    try {
      const res = await createUserSubscription(props.userId, {
        plan_id: 0,
        custom_name: values.custom_name || '',
        duration_unit: values.duration_unit,
        duration_value: Number(values.duration_value || 1),
        custom_seconds:
          values.duration_unit === 'custom'
            ? Number(values.custom_seconds || 0)
            : 0,
        allowed_models: values.allowed_models || '',
        total_amount: parseQuotaFromDollars(Number(values.total_amount || 0)),
      })
      if (res.success) {
        toast.success(t('Added successfully'))
        form.reset(DEFAULTS)
        setOpen(false)
        await props.onSuccess()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='rounded-md border'>
      <CollapsibleTrigger className='hover:bg-accent/50 flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2'>
        <span className='flex items-center gap-2 text-sm font-medium'>
          <Sparkles className='h-4 w-4' />
          {t('Custom assignment')}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4 border-t px-3 py-4'
          >
            <p className='text-muted-foreground text-sm'>
              {t(
                'Creates a subscription without a plan. Admin-assigned subscriptions are always charged before any other subscription or the wallet.'
              )}
            </p>

            <FormField
              control={form.control}
              name='custom_name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Subscription Name')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder={t('Custom assignment')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Leave empty to use the default name')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='duration_unit'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Duration Unit')}</FormLabel>
                    <Select
                      items={durationUnitOpts}
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
                          {durationUnitOpts.map((o) => (
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

              {durationUnit === 'custom' ? (
                <FormField
                  control={form.control}
                  name='custom_seconds'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Custom (seconds)')}</FormLabel>
                      <FormControl>
                        <Input {...field} type='number' min={0} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name='duration_value'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Duration Value')}</FormLabel>
                      <FormControl>
                        <Input {...field} type='number' min={1} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name='total_amount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Available amount')} ({getCurrencyLabel()})
                  </FormLabel>
                  <FormControl>
                    <Input {...field} type='number' step='0.01' min={0} />
                  </FormControl>
                  <FormDescription>{t('0 means unlimited')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <PlanModelsField
              control={form.control}
              name='allowed_models'
              modelOptions={modelOptions}
              label={t('Allowed Models')}
              description={t(
                'Only these models can be paid for by this subscription. Leave empty for no restriction. Requests for other models fall back to the wallet.'
              )}
              placeholder={t('Leave empty for no restriction')}
            />

            <div className='flex justify-end'>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting ? t('Saving...') : t('Assign subscription')}
              </Button>
            </div>
          </form>
        </Form>
      </CollapsibleContent>
    </Collapsible>
  )
}
