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
import * as z from 'zod'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsFormGridItem,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  CONTENT_REVIEW_MODES,
  type ContentReviewMode,
} from './content-review-mode'

const schema = z
  .object({
    mode: z.enum(CONTENT_REVIEW_MODES),
    model: z.string(),
    prompt: z.string(),
    timeoutMs: z.number().int().min(500).max(30000),
    maxInputChars: z.number().int().min(500).max(32000),
    group: z.string(),
    flagEnabled: z.boolean(),
    flagThreshold: z.number().min(0).max(1),
    blockThreshold: z.number().min(0).max(1),
    failOpen: z.boolean(),
    blockMessage: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.mode !== 'off' && values.model.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message:
          'Review model is required when content review is enabled',
      })
    }
  })

export type ContentReviewFormValues = z.infer<typeof schema>
type Values = ContentReviewFormValues

const OPTION_KEYS: Record<keyof Values, string> = {
  mode: 'content_review.mode',
  model: 'content_review.model',
  prompt: 'content_review.prompt',
  timeoutMs: 'content_review.timeout_ms',
  maxInputChars: 'content_review.max_input_chars',
  group: 'content_review.group',
  flagEnabled: 'content_review.flag_enabled',
  flagThreshold: 'content_review.flag_threshold',
  blockThreshold: 'content_review.block_threshold',
  failOpen: 'content_review.fail_open',
  blockMessage: 'content_review.block_message',
}

const MODE_OPTIONS: Array<{
  value: ContentReviewMode
  titleKey: string
  descriptionKey: string
}> = [
  {
    value: 'off',
    titleKey: 'Off',
    descriptionKey: 'Do not review prompts.',
  },
  {
    value: 'async',
    titleKey: 'Async',
    descriptionKey:
      'Review in the background. Never delay or block this request; high-risk users can still be flagged.',
  },
  {
    value: 'block',
    titleKey: 'Block',
    descriptionKey:
      'Wait for review and reject this request when the block threshold is hit.',
  },
]

export function ContentReviewSection({
  defaultValues,
  builtinPrompt,
}: {
  defaultValues: ContentReviewFormValues
  builtinPrompt: string
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues,
  })
  useResetForm(form, defaultValues)
  const mode = form.watch('mode')
  const enabled = mode !== 'off'
  const blocking = mode === 'block'
  const saving = updateOption.isPending || form.formState.isSubmitting

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []
    ;(Object.keys(OPTION_KEYS) as Array<keyof Values>).forEach((field) => {
      if (values[field] !== defaultValues[field]) {
        updates.push({
          key: OPTION_KEYS[field],
          value: String(values[field]),
        })
      }
    })
    if (values.mode !== defaultValues.mode) {
      updates.push({
        key: 'content_review.enabled',
        value: String(values.mode !== 'off'),
      })
      updates.push({
        key: 'content_review.block_enabled',
        value: String(values.mode === 'block'),
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Content Review')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={saving}
            isSaveDisabled={!form.formState.isDirty}
            saveLabel='Save content review settings'
          />

          <FormField
            control={form.control}
            name='mode'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Review mode')}</FormLabel>
                <FormDescription>
                  {t(
                    'Linear control: Off does nothing, Async reviews in the background, Block waits and can reject this request.'
                  )}
                </FormDescription>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={(value) => {
                      if (
                        value === 'off' ||
                        value === 'async' ||
                        value === 'block'
                      ) {
                        field.onChange(value)
                      }
                    }}
                    disabled={saving}
                    className='grid gap-3 sm:grid-cols-3'
                  >
                    {MODE_OPTIONS.map((option) => (
                      <Label
                        key={option.value}
                        htmlFor={`content-review-mode-${option.value}`}
                        className={cn(
                          'hover:border-primary/40 focus-within:border-primary/50 has-data-[checked]:border-primary has-data-[checked]:ring-primary/20 bg-card flex cursor-pointer flex-col gap-2 rounded-xl border p-4 font-normal transition-all has-data-[checked]:ring-2',
                          saving && 'pointer-events-none opacity-50'
                        )}
                      >
                        <div className='flex items-center gap-2'>
                          <RadioGroupItem
                            id={`content-review-mode-${option.value}`}
                            value={option.value}
                          />
                          <span className='text-sm font-semibold'>
                            {t(option.titleKey)}
                          </span>
                        </div>
                        <p className='text-muted-foreground text-xs leading-5'>
                          {t(option.descriptionKey)}
                        </p>
                      </Label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='model'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Review model')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder='gpt-4o-mini'
                    disabled={!enabled || saving}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Use a model name already configured in channels. Review calls use that channel and are not billed to the user.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='group'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Review channel group')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('Leave empty to use any group')}
                    disabled={!enabled || saving}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Optional. Use an enabled channel from this group. Leave empty to use any group.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='prompt'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center justify-between gap-2'>
                  <FormLabel>{t('Review prompt')}</FormLabel>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!enabled || saving}
                    onClick={() =>
                      form.setValue('prompt', builtinPrompt, {
                        shouldDirty: true,
                      })
                    }
                  >
                    {t('Reset to default prompt')}
                  </Button>
                </div>
                <FormControl>
                  <Textarea rows={16} disabled={!enabled || saving} {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'Pre-filled with the built-in default. Edit it as needed. User content is wrapped in <user_input> tags and treated as data.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <SettingsFormGrid>
            <SettingsFormGridItem>
              <FormField
                control={form.control}
                name='timeoutMs'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Timeout (ms)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={500}
                        max={30000}
                        disabled={!enabled || saving}
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'How long to wait for the review model. Timed-out reviews follow the fail-open setting.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGridItem>
            <SettingsFormGridItem>
              <FormField
                control={form.control}
                name='maxInputChars'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Max input characters')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={500}
                        max={32000}
                        disabled={!enabled || saving}
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Truncate reviewed text to this many characters before sending it to the review model.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGridItem>
          </SettingsFormGrid>

          <Alert>
            <Info />
            <AlertTitle>{t('How review scores work')}</AlertTitle>
            <AlertDescription className='space-y-2'>
              <p>
                {t(
                  'The review model scores each prompt from 0 to 1. 0 means clearly allowed, 1 means clearly against the review rules. The two thresholds split that score into three outcomes: allow, flag the user, or also reject this request.'
                )}
              </p>
              <p>
                {t(
                  'Example with the defaults 0.5 and 0.8: 0.3 is allowed; 0.6 is flagged but still allowed; 0.85 is flagged and blocked in Block mode. Async mode never blocks.'
                )}
              </p>
            </AlertDescription>
          </Alert>

          <FormField
            control={form.control}
            name='flagEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Flag high-risk users')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When the score reaches the flag threshold, the user is marked high-risk on the Users page. This only tags the account. It does not reject the current request.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!enabled || saving}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='flagThreshold'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Flag threshold')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!enabled || saving}
                    {...safeNumberFieldProps(field)}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Minimum score (0 to 1) that marks the user as high-risk. Default 0.5. The current request still continues. Keep this lower than the block threshold so you can watch suspicious users before blocking them.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='blockThreshold'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Block threshold')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!blocking || saving}
                    {...safeNumberFieldProps(field)}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Minimum score (0 to 1) that rejects this request. Default 0.8. Only applies in Block mode; Async mode ignores it. Keep this higher than the flag threshold so only stronger matches are rejected.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='failOpen'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Fail open on review errors')}</FormLabel>
                  <FormDescription>
                    {t(
                      'In Block mode, allow the original request if the review model fails, times out, or returns invalid JSON. Async mode always continues the request.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!enabled || saving}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='blockMessage'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Block message')}</FormLabel>
                <FormControl>
                  <Input disabled={!blocking || saving} {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'Error message returned to the client when a request is blocked.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
