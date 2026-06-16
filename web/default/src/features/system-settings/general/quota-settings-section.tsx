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
import type { ChangeEvent } from 'react'
import * as z from 'zod'
import type { Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
  SettingsFormGrid,
  SettingsFormGridItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

function getCurrencySymbol(currencyCode: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? currencyCode
  } catch {
    return currencyCode
  }
}

function quotaToCreditUnits(quota: number, quotaPerUnit: number): number {
  if (quotaPerUnit <= 0) return 0
  return quota / quotaPerUnit
}

function creditUnitsToQuota(units: number, quotaPerUnit: number): number {
  return Math.round(units * quotaPerUnit)
}

const quotaSchema = z.object({
  QuotaForNewUser: z.coerce.number().min(0),
  PreConsumedQuota: z.coerce.number().min(0),
  QuotaForInviter: z.coerce.number().min(0),
  QuotaForInvitee: z.coerce.number().min(0),
  TopUpLink: z.string(),
  general_setting: z.object({
    docs_link: z.string(),
  }),
  quota_setting: z.object({
    enable_free_model_pre_consume: z.boolean(),
  }),
})

type QuotaFormValues = z.infer<typeof quotaSchema>

type RawQuotaValues = {
  QuotaForNewUser: number
  PreConsumedQuota: number
  QuotaForInviter: number
  QuotaForInvitee: number
  TopUpLink: string
  general_setting: { docs_link: string }
  quota_setting: { enable_free_model_pre_consume: boolean }
}

type PaymentInfo = {
  quotaPerUnit: number
  currency: string
}

type QuotaSettingsSectionProps = {
  defaultValues: RawQuotaValues
  paymentInfo?: PaymentInfo
  complianceConfirmed?: boolean
}

export function QuotaSettingsSection({
  defaultValues,
  paymentInfo,
  complianceConfirmed = true,
}: QuotaSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const quotaPerUnit = paymentInfo?.quotaPerUnit ?? 500000
  const currency = paymentInfo?.currency ?? 'CNY'
  const currencySymbol = getCurrencySymbol(currency)

  const toFormValues = (raw: RawQuotaValues): QuotaFormValues => ({
    QuotaForNewUser: quotaToCreditUnits(raw.QuotaForNewUser, quotaPerUnit),
    PreConsumedQuota: quotaToCreditUnits(raw.PreConsumedQuota, quotaPerUnit),
    QuotaForInviter: quotaToCreditUnits(raw.QuotaForInviter, quotaPerUnit),
    QuotaForInvitee: quotaToCreditUnits(raw.QuotaForInvitee, quotaPerUnit),
    TopUpLink: raw.TopUpLink,
    general_setting: raw.general_setting,
    quota_setting: raw.quota_setting,
  })

  const handleNumberChange =
    (onChange: (value: number | string) => void) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(
        event.target.value === '' ? '' : event.currentTarget.valueAsNumber
      )
    }

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<QuotaFormValues>({
      resolver: zodResolver(quotaSchema) as Resolver<
        QuotaFormValues,
        unknown,
        QuotaFormValues
      >,
      defaultValues: toFormValues(defaultValues),
      onSubmit: async (_data, changedFields) => {
        const quotaFields = new Set([
          'QuotaForNewUser',
          'PreConsumedQuota',
          'QuotaForInviter',
          'QuotaForInvitee',
        ])
        for (const [key, value] of Object.entries(changedFields)) {
          const saved =
            quotaFields.has(key) && typeof value === 'number'
              ? creditUnitsToQuota(value, quotaPerUnit)
              : value
          await updateOption.mutateAsync({
            key,
            value: saved as string | number | boolean,
          })
        }
      },
    })

  return (
    <SettingsSection title={t('Quota Settings')}>
      <FormNavigationGuard when={isDirty} />

      {!complianceConfirmed ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'Non-zero invitation rewards require compliance confirmation in Payment Gateway settings.'
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit}>
          <SettingsPageFormActions
            onSave={handleSubmit}
            isSaving={updateOption.isPending || isSubmitting}
          />
          <FormDirtyIndicator isDirty={isDirty} />
          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='QuotaForNewUser'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('New User Balance')}</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupAddon>{currencySymbol}</InputGroupAddon>
                      <InputGroupInput
                        type='number'
                        step='0.01'
                        min='0'
                        value={field.value ?? ''}
                        onChange={handleNumberChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                      />
                    </InputGroup>
                  </FormControl>
                  <FormDescription>
                    {t('Initial balance given to new users (in {{currency}})', {
                      currency,
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='PreConsumedQuota'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Pre-Consumed Balance')}</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupAddon>{currencySymbol}</InputGroupAddon>
                      <InputGroupInput
                        type='number'
                        step='0.01'
                        min='0'
                        value={field.value ?? ''}
                        onChange={handleNumberChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                      />
                    </InputGroup>
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Balance reserved before request completes (in {{currency}})',
                      { currency }
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='QuotaForInviter'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Inviter Reward')}</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupAddon>{currencySymbol}</InputGroupAddon>
                      <InputGroupInput
                        type='number'
                        step='0.01'
                        min='0'
                        value={field.value ?? ''}
                        onChange={handleNumberChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                      />
                    </InputGroup>
                  </FormControl>
                  <FormDescription>
                    {t('Balance given to users who invite others (in {{currency}})', {
                      currency,
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='QuotaForInvitee'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Invitee Reward')}</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupAddon>{currencySymbol}</InputGroupAddon>
                      <InputGroupInput
                        type='number'
                        step='0.01'
                        min='0'
                        value={field.value ?? ''}
                        onChange={handleNumberChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                      />
                    </InputGroup>
                  </FormControl>
                  <FormDescription>
                    {t('Balance given to invited users (in {{currency}})', {
                      currency,
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SettingsFormGridItem span='full'>
              <FormField
                control={form.control}
                name='quota_setting.enable_free_model_pre_consume'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Pre-Consume for Free Models')}</FormLabel>
                      <FormDescription>
                        {t(
                          'When enabled, zero-cost models also pre-consume quota before final settlement.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={updateOption.isPending}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
            </SettingsFormGridItem>

            <FormField
              control={form.control}
              name='TopUpLink'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Top-Up Link')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('https://example.com/topup')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('External link for users to purchase quota')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='general_setting.docs_link'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Documentation Link')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('https://docs.example.com')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Link to your documentation site')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
