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
import { useMemo } from 'react'
import type { Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { MultiSelect } from '@/components/multi-select'
import type { PlanFormValues } from '../lib'
import { parseDisplayModels } from '../lib/display-models'

interface PlanDisplayModelsFieldProps {
  control: Control<PlanFormValues>
  modelOptions: { value: string; label: string }[]
}

export function PlanDisplayModelsField(props: PlanDisplayModelsFieldProps) {
  const { t } = useTranslation()
  const knownValues = useMemo(
    () => new Set(props.modelOptions.map((o) => o.value)),
    [props.modelOptions]
  )

  return (
    <FormField
      control={props.control}
      name='display_models'
      render={({ field }) => {
        const selected = parseDisplayModels(field.value || '')
        const extras = selected
          .filter((m) => !knownValues.has(m))
          .map((m) => ({ value: m, label: m }))
        const options =
          extras.length > 0
            ? [...props.modelOptions, ...extras]
            : props.modelOptions

        return (
          <FormItem>
            <FormLabel>{t('Display Models')}</FormLabel>
            <FormControl>
              <MultiSelect
                options={options}
                selected={selected}
                onChange={(values) => field.onChange(values.join(','))}
                placeholder={t('Select models to showcase')}
              />
            </FormControl>
            <FormDescription>
              {t(
                'Shown on the purchase page as "how much of this model the quota is worth".'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
