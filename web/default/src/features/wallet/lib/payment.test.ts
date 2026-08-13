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
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  getStripeTopupAmountInUSD,
  getPaymentMethodMinTopup,
  isBelowPaymentMethodMinTopup,
  normalizePaymentAmount,
} from './payment'

const topupInfo = {
  enable_online_topup: true,
  enable_stripe_topup: true,
  pay_methods: [],
  min_topup: 10,
  stripe_min_topup: 25,
  amount_options: [],
  discount: {},
}

describe('payment amount normalization', () => {
  test('converts token display amounts to USD before Stripe Checkout rounding', () => {
    const amountUSD = getStripeTopupAmountInUSD(1_500_000, {
      quotaDisplayType: 'TOKENS',
      quotaPerUnit: 500_000,
    })

    assert.equal(amountUSD, 3)
    assert.equal(normalizePaymentAmount(amountUSD, 'stripe'), 3)
  })

  test('rounds Stripe custom amounts up to whole USD units', () => {
    assert.equal(normalizePaymentAmount(13 / 7, 'stripe'), 2)
    assert.equal(normalizePaymentAmount(8 / 7, 'stripe'), 2)
    assert.equal(normalizePaymentAmount(14 / 7, 'stripe'), 2)
  })

  test('keeps non-Stripe payment normalization unchanged', () => {
    assert.equal(normalizePaymentAmount(13 / 7, 'alipay'), 1)
  })
})

describe('payment method minimum topup', () => {
  test('uses the configured Stripe minimum over legacy method and general minima', () => {
    const stripeMethod = { type: 'stripe', min_topup: 100 }

    assert.equal(getPaymentMethodMinTopup(stripeMethod, topupInfo), 25)
    assert.equal(isBelowPaymentMethodMinTopup(24, stripeMethod, topupInfo), true)
    assert.equal(isBelowPaymentMethodMinTopup(25, stripeMethod, topupInfo), false)
  })

  test('keeps non-Stripe method minimum behavior unchanged', () => {
    const alipayMethod = { type: 'alipay', min_topup: 15 }

    assert.equal(getPaymentMethodMinTopup(alipayMethod, topupInfo), 15)
    assert.equal(isBelowPaymentMethodMinTopup(14, alipayMethod, topupInfo), true)
  })

  test('allows Stripe payments at any non-negative amount when no minimum is configured', () => {
    const stripeMethod = { type: 'stripe', min_topup: 100 }
    const unrestrictedTopupInfo = { ...topupInfo, stripe_min_topup: 0 }

    assert.equal(getPaymentMethodMinTopup(stripeMethod, unrestrictedTopupInfo), 0)
    assert.equal(
      isBelowPaymentMethodMinTopup(0, stripeMethod, unrestrictedTopupInfo),
      false
    )
  })
})
