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
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { getEffectiveRatio, formatRatioLabel } from '../lib/price'
import type { PricingModel } from '../types'

/**
 * Map an effective ratio to a badge color tier.
 *
 * Cheaper (lower ratio) trends green; pricier (higher ratio) trends red, so
 * the "deal level" reads at a glance. Thresholds are intentionally simple and
 * easy to tune.
 */
function ratioVariant(ratio: number): StatusVariant {
  if (ratio < 0.5) return 'success' // big discount
  if (ratio < 1) return 'info' // some discount
  if (ratio === 1) return 'neutral' // normal price
  if (ratio < 2) return 'warning' // premium
  return 'danger' // expensive
}

/** Soft tinted background per tier, paired with the variant's text color. */
const SOFT_BG: Partial<Record<StatusVariant, string>> = {
  success: 'bg-success/10',
  info: 'bg-info/10',
  neutral: 'bg-neutral/10',
  warning: 'bg-warning/10',
  danger: 'bg-destructive/10',
}

/**
 * Small colored badge showing a model's effective ratio, rendered next to the
 * model name in the marketplace.
 *
 * Value is the minimum effective ratio (group ratio × minimum channel ratio)
 * across the model's enabled groups — the same basis as the displayed prices.
 * By default the neutral `x1` case is hidden to keep the UI clean (set
 * `showWhenOne` to always render it).
 */
export function RatioBadge(props: {
  model: PricingModel
  size?: 'sm' | 'md' | 'lg'
  showWhenOne?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const ratio = getEffectiveRatio(props.model)
  const label = formatRatioLabel(ratio)

  // Hide when the badge would read "x1" (original price). Comparing the rendered
  // label (not ratio === 1) also catches float results like 0.9999998 that round
  // to 1 at display precision.
  if (label === 'x1' && !props.showWhenOne) return null

  const variant = ratioVariant(ratio)

  return (
    <StatusBadge
      variant={variant}
      size={props.size ?? 'sm'}
      copyable={false}
      // No fixed height: hug the text so the badge height tracks the font size
      // (incl. smaller text on mobile). Render label as children (not the label
      // prop) so the badge's leading-none applies instead of leading-normal.
      className={cn('h-auto py-px px-1.5', SOFT_BG[variant], props.className)}
      title={`${t('Ratio')}: ${t('Group ratio × minimum channel ratio')}`}
    >
      {label}
    </StatusBadge>
  )
}
