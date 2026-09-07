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
import i18n from '@/i18n/config'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'
import { formatBillingCurrencyFromCNY } from './currency'

const originalCurrency = { ...useSystemConfigStore.getState().config.currency }
const originalLanguage = i18n.language

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, usdExchangeRate: 7 },
  })
})

afterEach(async () => {
  useSystemConfigStore.getState().setConfig({ currency: originalCurrency })
  await i18n.changeLanguage(originalLanguage)
})

describe('CNY payment quotes use the global billing currency', () => {
  test('shows a 10 CNY quote as yuan in Simplified Chinese', async () => {
    await i18n.changeLanguage('zh')
    assert.equal(formatBillingCurrencyFromCNY(10), '¥10')
    assert.equal(formatBillingCurrencyFromCNY(70), '¥70')
  })

  test('converts a 70 CNY quote to 10 USD in other supported languages', async () => {
    for (const language of ['en', 'fr', 'ja', 'ru', 'vi', 'zh-TW']) {
      await i18n.changeLanguage(language)
      assert.equal(formatBillingCurrencyFromCNY(70), '$10', language)
    }
  })

  test('preserves the quoted price and discounts instead of reconstructing credit', async () => {
    // Backend quote: 10 USD credit × Price 5 CNY/USD × group ratio 0.8 × discount 0.7.
    // Display must convert the actual 28 CNY cost using USDExchangeRate 7, not Price 5.
    assert.equal(formatBillingCurrencyFromCNY(28), '$4')
    await i18n.changeLanguage('zh')
    assert.equal(formatBillingCurrencyFromCNY(28), '¥28')
  })

  test('respects configured CNY and custom currencies and the billing token fallback', () => {
    for (const [quotaDisplayType, expected] of [
      ['CNY', '¥70'],
      ['CUSTOM', '¤ 30'],
      ['TOKENS', '$10'],
    ] as const) {
      useSystemConfigStore.getState().setConfig({
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType,
          usdExchangeRate: 7,
          customCurrencyExchangeRate: 3,
        },
      })
      assert.equal(formatBillingCurrencyFromCNY(70), expected)
    }
  })

  test('normalizes invalid exchange rates through the global configuration', () => {
    for (const usdExchangeRate of [0, -7, Number.NaN]) {
      useSystemConfigStore.getState().setConfig({
        currency: { ...DEFAULT_CURRENCY_CONFIG, usdExchangeRate },
      })
      assert.equal(formatBillingCurrencyFromCNY(10), '$10')
    }
  })

  test('preserves zero, missing values, and formatting options', () => {
    assert.equal(formatBillingCurrencyFromCNY(0), '$0')
    assert.equal(formatBillingCurrencyFromCNY(null), '-')
    assert.equal(formatBillingCurrencyFromCNY(undefined), '-')
    assert.equal(formatBillingCurrencyFromCNY(Number.NaN), '-')
    assert.equal(formatBillingCurrencyFromCNY(10, { digitsLarge: 3 }), '$1.429')
  })
})
