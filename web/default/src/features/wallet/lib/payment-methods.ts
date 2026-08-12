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

export type PaymentMethodCategory =
  | 'balance'
  | 'card'
  | 'epay'
  | 'normal'
  | 'crypto'

export interface PaymentMethodItemModel {
  id: string
  label: string
  category: PaymentMethodCategory
  disabled?: boolean
  disabledReason?: string
}

const CATEGORY_PRIORITY: Record<PaymentMethodCategory, number> = {
  balance: 0,
  card: 1,
  epay: 2,
  normal: 3,
  crypto: 4,
}

const CRYPTO_PATTERN =
  /(?:^|[\s_-])(crypto|virtual|usdt|usdc|bitcoin|btc|ethereum|eth|pancake)(?:$|[\s_-])/i
const CARD_PATTERN =
  /(?:^|[\s_-])(stripe|card|credit|visa|mastercard|unionpay)(?:$|[\s_-])/i

interface ClassifyPaymentMethodOptions {
  type?: string
  name?: string
  provider?: 'epay' | 'other'
  fallback?: Extract<PaymentMethodCategory, 'epay' | 'normal'>
}

/**
 * Conservatively classifies backend-provided payment methods. Consumers can
 * always set a category explicitly; crypto wins over card so virtual-currency
 * methods cannot accidentally appear among card methods.
 */
export function classifyPaymentMethod({
  type,
  name,
  provider = 'other',
  fallback,
}: ClassifyPaymentMethodOptions): PaymentMethodCategory {
  const searchable = `${type || ''} ${name || ''}`.trim()

  if (CRYPTO_PATTERN.test(searchable)) return 'crypto'
  if (CARD_PATTERN.test(searchable)) return 'card'
  if (provider === 'epay') return 'epay'
  return fallback || 'normal'
}

/** Stable category sort: items in the same category retain input order. */
export function sortPaymentMethods<T extends PaymentMethodItemModel>(
  items: readonly T[]
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        CATEGORY_PRIORITY[left.item.category] -
          CATEGORY_PRIORITY[right.item.category] || left.index - right.index
    )
    .map(({ item }) => item)
}
