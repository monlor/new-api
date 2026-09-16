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
import { useMemo, type ReactNode } from 'react'
import type { Control, FieldValues, Path } from 'react-hook-form'
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
import { parseDisplayModels } from '../lib/display-models'

interface PlanModelsFieldProps<T extends FieldValues> {
  control: Control<T>
  /** Comma-separated string field to bind, e.g. display_models / allowed_models. */
  name: Path<T>
  modelOptions: { value: string; label: string }[]
  label?: ReactNode
  description?: ReactNode
  placeholder?: string
}

/**
 * Multi-select bound to a comma-separated model list. Shared by the plan form,
 * the custom-assignment form and the single-subscription edit form.
 */
export function PlanModelsField<T extends FieldValues>(
  props: PlanModelsFieldProps<T>
) {
  const { t } = useTranslation()
  const knownValues = useMemo(
    () => new Set(props.modelOptions.map((o) => o.value)),
    [props.modelOptions]
  )

  return (
    <FormField
      control={props.control}
      name={props.name}
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
            <FormLabel>{props.label ?? t('Display Models')}</FormLabel>
            <FormControl>
              <MultiSelect
                options={options}
                selected={selected}
                onChange={(values) => field.onChange(values.join(','))}
                placeholder={
                  props.placeholder ?? t('Select models to showcase')
                }
              />
            </FormControl>
            {props.description ? (
              <FormDescription>{props.description}</FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
