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
import { formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/status-badge'
import { getReasoningEffortBadgeVariant } from '../lib/reasoning-effort'

const cardClassName =
  'h-6 shrink-0 rounded-md px-2 [font-family:var(--font-body)]'

const effortCardTone: Record<string, string> = {
  orange:
    'border border-amber-200/45 bg-amber-50/35 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/15 dark:text-amber-400',
  yellow:
    'border border-amber-200/45 bg-amber-50/35 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/15 dark:text-amber-400',
  green:
    'border border-emerald-200/40 bg-emerald-50/35 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/15 dark:text-emerald-400',
  neutral:
    'border border-border/60 bg-muted/30 text-muted-foreground dark:border-border/40 dark:bg-muted/20',
}

export function ReasoningEffortBadge({ effort }: { effort: string }) {
  const variant = getReasoningEffortBadgeVariant(effort) ?? 'neutral'

  return (
    <StatusBadge
      type='badge'
      label={effort}
      variant={variant}
      size='sm'
      copyable={false}
      className={cn(
        cardClassName,
        effortCardTone[variant] ?? effortCardTone.neutral
      )}
    />
  )
}

export function ThinkingBudgetBadge({
  budget,
  label,
}: {
  budget: number
  label: string
}) {
  const amount = budget === 0 ? '0' : formatTokens(budget)
  return (
    <StatusBadge
      type='badge'
      label={`${label} ${amount}`}
      variant='neutral'
      size='sm'
      copyable={false}
      className={cn(cardClassName, effortCardTone.neutral)}
    />
  )
}
