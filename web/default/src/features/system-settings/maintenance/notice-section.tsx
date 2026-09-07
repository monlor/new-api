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
import * as z from 'zod'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ANNOUNCEMENT_LOCALES,
  type AnnouncementLocale,
} from '@/lib/announcement-localization'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const noticeSchema = z.object({
  translations: z
    .record(z.string(), z.string().optional())
    .superRefine((translations, ctx) => {
      const normalized = Object.fromEntries(
        Object.entries(translations).map(([language, content]) => [
          language,
          (content ?? '').trim(),
        ])
      )
      const hasLocalizedContent = Object.values(normalized).some(Boolean)
      if (hasLocalizedContent && !normalized.en) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['en'],
          message: 'English is the default notice and is required.',
        })
      }
      for (const [language, content] of Object.entries(translations)) {
        if ((content ?? '').length > 500) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [language],
            message: 'Content must be less than 500 characters',
          })
        }
      }
    }),
})

type NoticeFormValues = z.infer<typeof noticeSchema>

type NoticeSectionProps = {
  defaultValue: string
}

function parseNotice(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([, content]) => typeof content === 'string'
        )
      ) as Record<string, string>
    }
  } catch {
    // Plain-string notices are legacy English notices.
  }
  return { en: value }
}

export function NoticeSection({ defaultValue }: NoticeSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [locale, setLocale] = useState<AnnouncementLocale>('en')
  const form = useForm<NoticeFormValues>({
    resolver: zodResolver(noticeSchema),
    defaultValues: {
      translations: parseNotice(defaultValue ?? ''),
    },
  })

  useEffect(() => {
    form.reset({ translations: parseNotice(defaultValue ?? '') })
  }, [defaultValue, form])

  const onSubmit = async (values: NoticeFormValues) => {
    const normalized = Object.fromEntries(
      Object.entries(values.translations).filter(([, content]) =>
        content?.trim()
      )
    )
    await updateOption.mutateAsync({
      key: 'Notice',
      value:
        Object.keys(normalized).length === 0 ? '' : JSON.stringify(normalized),
    })
  }

  const onInvalid = (errors: FieldErrors<NoticeFormValues>) => {
    if (errors.translations?.en && locale !== 'en') {
      setLocale('en')
    }
    toast.error(
      t(
        errors.translations?.en?.message ||
          'Please fix the highlighted fields before saving'
      )
    )
  }

  const englishError = form.formState.errors.translations?.en

  return (
    <SettingsSection title={t('System Notice')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit, onInvalid)}
            isSaving={updateOption.isPending}
            isSaveDisabled={!form.formState.isDirty}
            saveLabel='Save notice'
          />
          <div className='space-y-4' data-settings-form-span='full'>
            <div className='space-y-1'>
              <FormLabel>{t('Select Language')}</FormLabel>
              <Select
                value={locale}
                onValueChange={(value) =>
                  setLocale(value as AnnouncementLocale)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {ANNOUNCEMENT_LOCALES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                {locale === 'en'
                  ? t('English is the default notice and is required.')
                  : t(
                      'When this language is empty, users see the English notice.'
                    )}
              </FormDescription>
            </div>
            <FormField
              key={locale}
              control={form.control}
              name={`translations.${locale}`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Announcement content')}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={8}
                      placeholder={t(
                        'Planned maintenance on Friday at 22:00 UTC...'
                      )}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Maximum 500 characters. Supports Markdown and HTML.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {locale !== 'en' && englishError?.message ? (
              <p className='text-destructive text-sm'>
                {t(englishError.message)}
              </p>
            ) : null}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
