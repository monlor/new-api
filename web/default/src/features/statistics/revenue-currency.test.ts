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
import i18n from '@/i18n/config'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'
import {
  formatBillingCurrencyFromUSD,
  formatCurrencyFromUSD,
} from '@/lib/currency'

/**
 * Revenue amounts from `/api/statistics/revenue` are system USD. Epay's
 * gateway CNY is converted on the backend (`money / Price`) before the UI
 * formats with `formatBillingCurrencyFromUSD`. They must never be rendered as
 * a token count: "tokens" is a quota display unit, and paying $100 does not
 * mean paying 50,000,000 of anything.
 *
 * Regression guard for the bug where the revenue tab used
 * `formatCurrencyFromUSD`, which multiplies by `quotaPerUnit` under the TOKENS
 * display mode and rendered a $100 order as "50000k".
 */
const originalCurrency = { ...useSystemConfigStore.getState().config.currency }
const originalLanguage = i18n.language

function setDisplayType(quotaDisplayType: 'USD' | 'CNY' | 'TOKENS' | 'CUSTOM') {
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      usdExchangeRate: 7,
      quotaDisplayType,
    },
  })
}

beforeEach(async () => {
  // The TOKENS bug is only reachable in non-Chinese UIs: getConfig() forces
  // CNY for Simplified Chinese, which masks it.
  await i18n.changeLanguage('en')
  setDisplayType('USD')
})

afterEach(async () => {
  useSystemConfigStore.getState().setConfig({ currency: originalCurrency })
  await i18n.changeLanguage(originalLanguage)
})

describe('revenue amounts are never displayed as token counts', () => {
  test('a $100 order stays currency under the TOKENS display mode', () => {
    setDisplayType('TOKENS')

    // The old, wrong helper multiplies by quotaPerUnit (500000) -> "50000k".
    assert.equal(formatCurrencyFromUSD(100), '50000k')

    // The billing helper coerces TOKENS to USD at rate 1 and stays money.
    assert.equal(formatBillingCurrencyFromUSD(100), '$100')
  })

  test('the two helpers agree for every non-token display mode', () => {
    for (const displayType of ['USD', 'CNY', 'CUSTOM'] as const) {
      setDisplayType(displayType)
      for (const amount of [0, 1, 12.34, 100, 250000]) {
        assert.equal(
          formatBillingCurrencyFromUSD(amount),
          formatCurrencyFromUSD(amount),
          `${displayType} @ ${amount}`
        )
      }
    }
  })

  test('respects the configured exchange rate rather than hardcoding USD', () => {
    setDisplayType('CNY')
    assert.equal(formatBillingCurrencyFromUSD(10), '¥70')
  })

  test('renders zero and nullish revenue without crashing', () => {
    setDisplayType('TOKENS')
    assert.equal(formatBillingCurrencyFromUSD(0), '$0')
    assert.equal(formatBillingCurrencyFromUSD(null), '-')
    assert.equal(formatBillingCurrencyFromUSD(undefined), '-')
  })
})
