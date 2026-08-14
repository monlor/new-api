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
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import {
  ANNOUNCEMENT_LOCALES,
  type AnnouncementLocale,
} from '@/lib/announcement-localization'
import {
  Form,
  FormControl,
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
    .record(z.string(), z.string())
    .superRefine((translations, ctx) => {
      const hasLocalizedContent = Object.values(translations).some((content) =>
        content.trim()
      )
      if (hasLocalizedContent && !translations.en?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['en'],
          message: 'English content is required',
        })
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
    if (!form.formState.isDirty) return
    const normalized = Object.fromEntries(
      Object.entries(values.translations).filter(([, content]) =>
        content.trim()
      )
    )
    await updateOption.mutateAsync({
      key: 'Notice',
      value: JSON.stringify(normalized),
    })
  }

  return (
    <SettingsSection title={t('System Notice')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save notice'
          />
          <FormField
            control={form.control}
            name={`translations.${locale}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Announcement content')}</FormLabel>
                <Select
                  value={locale}
                  onValueChange={(value) =>
                    setLocale(value as AnnouncementLocale)
                  }
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    {ANNOUNCEMENT_LOCALES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <p className='text-muted-foreground text-sm'>
                  {locale === 'en'
                    ? t('English is the default notice and is required.')
                    : t(
                        'When this language is empty, users see the English notice.'
                      )}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
