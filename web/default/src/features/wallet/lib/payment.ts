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
import {
  PAYMENT_TYPES,
  DEFAULT_PRESET_MULTIPLIERS,
  DEFAULT_PAYMENT_TYPE,
  DEFAULT_MIN_TOPUP,
} from '../constants'
import {
  DEFAULT_CURRENCY_CONFIG,
  type CurrencyConfig,
} from '@/stores/system-config-store'
import type { PaymentMethod, PresetAmount, TopupInfo } from '../types'

// ============================================================================
// Payment Processing Functions
// ============================================================================

/**
 * Check if browser is Safari
 */
function isSafariBrowser(): boolean {
  return (
    navigator.userAgent.indexOf('Safari') > -1 &&
    navigator.userAgent.indexOf('Chrome') < 1
  )
}

/**
 * Submit payment form (for non-Stripe payments)
 */
export function submitPaymentForm(
  url: string,
  params: Record<string, unknown>
): void {
  const form = document.createElement('form')
  form.action = url
  form.method = 'POST'

  // Don't open in new tab for Safari
  if (!isSafariBrowser()) {
    form.target = '_blank'
  }

  // Add form parameters
  Object.entries(params).forEach(([key, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = key
    input.value = String(value)
    form.appendChild(input)
  })

  document.body.appendChild(form)
  form.submit()
  document.body.removeChild(form)
}

/**
 * Check if payment method is Stripe
 */
export function isStripePayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.STRIPE
}

/**
 * Get the applicable minimum for a selected payment method.
 *
 * Stripe's configured minimum is authoritative and intentionally does not
 * inherit a legacy per-method or general online-topup minimum. Other methods
 * preserve the existing behavior of enforcing the higher applicable minimum.
 */
export function getPaymentMethodMinTopup(
  method: Pick<PaymentMethod, 'type' | 'min_topup'>,
  topupInfo: TopupInfo | null
): number {
  if (isStripePayment(method.type.toLowerCase())) {
    return topupInfo?.stripe_min_topup ?? 0
  }

  return Math.max(method.min_topup || 0, getMinTopupAmount(topupInfo))
}

/**
 * Whether the entered amount is below the selected method's payment minimum.
 */
export function isBelowPaymentMethodMinTopup(
  topupAmount: number,
  method: Pick<PaymentMethod, 'type' | 'min_topup'>,
  topupInfo: TopupInfo | null
): boolean {
  return topupAmount < getPaymentMethodMinTopup(method, topupInfo)
}

/**
 * Normalize a topup amount for the payment provider's request contract.
 *
 * Stripe Checkout uses a fixed Price with an integer Quantity, so a partial
 * USD amount must be charged as the next whole USD unit. Other providers keep
 * their existing integer truncation behavior.
 */
export function normalizePaymentAmount(
  topupAmount: number,
  paymentType: string
): number {
  if (!isStripePayment(paymentType)) {
    return Math.floor(topupAmount)
  }

  // Currency conversion can produce a value such as 2.0000000000000004 for
  // an exact whole-dollar amount. Account for that floating-point noise before
  // rounding up so it does not become the next USD unit.
  const precision = Number.EPSILON * Math.max(1, Math.abs(topupAmount))
  return Math.ceil(topupAmount - precision)
}

/**
 * Convert the amount submitted by the wallet to the USD units used by Stripe.
 *
 * Token display mode keeps the entered recharge amount as raw quota, while
 * Stripe Checkout prices are denominated in whole USD units. This mirrors the
 * server-side conversion before the Checkout quantity is rounded up.
 */
export function getStripeTopupAmountInUSD(
  topupAmount: number,
  currency: Pick<CurrencyConfig, 'quotaDisplayType' | 'quotaPerUnit'>
): number {
  if (currency.quotaDisplayType !== 'TOKENS') {
    return topupAmount
  }

  const quotaPerUnit =
    currency.quotaPerUnit > 0
      ? currency.quotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  return topupAmount / quotaPerUnit
}

/**
 * Check if payment method is Waffo Pancake
 *
 * Pancake is a metered-style payment that goes through a dedicated checkout
 * URL flow rather than the generic epay form submission, so it must be
 * special-cased in payment dispatch logic.
 */
export function isWaffoPancakePayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.WAFFO_PANCAKE
}

/**
 * Get default payment type from topup info
 */
export function getDefaultPaymentType(topupInfo: TopupInfo | null): string {
  if (!topupInfo) {
    return DEFAULT_PAYMENT_TYPE
  }

  // Return first available payment method or default
  if (topupInfo.pay_methods?.length > 0) {
    return topupInfo.pay_methods[0].type
  }

  if (topupInfo.enable_stripe_topup) {
    return PAYMENT_TYPES.STRIPE
  }

  if (topupInfo.enable_waffo_topup) {
    return PAYMENT_TYPES.WAFFO
  }

  if (topupInfo.enable_waffo_pancake_topup) {
    return PAYMENT_TYPES.WAFFO_PANCAKE
  }

  return DEFAULT_PAYMENT_TYPE
}

/**
 * Get minimum topup amount from topup info
 */
export function getMinTopupAmount(topupInfo: TopupInfo | null): number {
  if (!topupInfo) {
    return DEFAULT_MIN_TOPUP
  }

  if (topupInfo.enable_online_topup) {
    return topupInfo.min_topup
  }

  if (topupInfo.enable_stripe_topup) {
    return topupInfo.stripe_min_topup
  }

  if (topupInfo.enable_waffo_topup) {
    return topupInfo.waffo_min_topup || DEFAULT_MIN_TOPUP
  }

  if (topupInfo.enable_waffo_pancake_topup) {
    return topupInfo.waffo_pancake_min_topup || DEFAULT_MIN_TOPUP
  }

  return DEFAULT_MIN_TOPUP
}

/**
 * Generate preset amounts based on minimum topup
 */
export function generatePresetAmounts(minAmount: number): PresetAmount[] {
  return DEFAULT_PRESET_MULTIPLIERS.map((multiplier) => ({
    value: minAmount * multiplier,
  }))
}

/**
 * Merge custom preset amounts with discounts
 */
export function mergePresetAmounts(
  amountOptions: number[],
  discounts: Record<number, number>
): PresetAmount[] {
  if (!amountOptions || amountOptions.length === 0) {
    return []
  }

  return amountOptions.map((amount) => ({
    value: amount,
    discount: discounts[amount] || 1.0,
  }))
}
