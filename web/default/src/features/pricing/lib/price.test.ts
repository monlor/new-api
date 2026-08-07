import i18n from '@/i18n/config'
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'
import type { PricingModel } from '../types'
import {
  formatDynamicUnitPrice,
  getDynamicPricingSummary,
} from './dynamic-price'
import {
  calculateRequestPriceUSD,
  calculateTokenPriceUSD,
  formatPrice,
  getEffectiveRatioRange,
  getMinEffectiveRatio,
} from './price'

const model: PricingModel = {
  id: 1,
  model_name: 'test-model',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 4,
  model_price: 0.25,
  cache_ratio: 0.1,
  create_cache_ratio: 1.25,
  image_ratio: 2,
  audio_ratio: 3,
  audio_completion_ratio: 5,
  enable_groups: ['free', 'pro'],
  group_ratio: { free: 0, pro: 0.5 },
  group_channel_ratio_min: { free: 1, pro: 0.8 },
  group_channel_ratio_max: { free: 1, pro: 1.2 },
}

const originalCurrency = {
  ...useSystemConfigStore.getState().config.currency,
}

before(async () => {
  await i18n.changeLanguage('en')
})

after(() => {
  useSystemConfigStore.getState().setConfig({ currency: originalCurrency })
})

describe('pricing ratio calculations', () => {
  test('combines group and channel ratios and preserves zero', () => {
    assert.deepEqual(
      getEffectiveRatioRange('pro', { pro: 0.5 }, { pro: 0.8 }, { pro: 1.2 }),
      { min: 0.4, max: 0.6 }
    )
    assert.deepEqual(getEffectiveRatioRange('free', { free: 0 }), {
      min: 0,
      max: 0,
    })
    assert.deepEqual(
      getEffectiveRatioRange('pro', { pro: 0.5 }, { pro: 0.8 }),
      { min: 0.4, max: 0.4 }
    )
    assert.equal(
      getMinEffectiveRatio(
        model.enable_groups,
        model.group_ratio!,
        model.group_channel_ratio_min
      ),
      0
    )
  })

  test('supports wallet and subscription channel ranges independently', () => {
    assert.deepEqual(
      getEffectiveRatioRange('pro', { pro: 2 }, { pro: 0.5 }, { pro: 0.75 }),
      { min: 1, max: 1.5 }
    )
    assert.deepEqual(
      getEffectiveRatioRange('pro', { pro: 2 }, { pro: 1.25 }, { pro: 1.5 }),
      { min: 2.5, max: 3 }
    )
  })

  test('calculates every standard token price and per-request price', () => {
    assert.equal(calculateTokenPriceUSD(model, 'input', 0.5), 1)
    assert.equal(calculateTokenPriceUSD(model, 'output', 0.5), 4)
    assert.equal(calculateTokenPriceUSD(model, 'cache', 0.5), 0.1)
    assert.equal(calculateTokenPriceUSD(model, 'create_cache', 0.5), 1.25)
    assert.equal(calculateTokenPriceUSD(model, 'image', 0.5), 2)
    assert.equal(calculateTokenPriceUSD(model, 'audio_input', 0.5), 3)
    assert.equal(calculateTokenPriceUSD(model, 'audio_output', 0.5), 15)
    assert.equal(calculateRequestPriceUSD(model, 0.5), 0.125)
  })
})

describe('pricing currency and unit formatting', () => {
  const setCurrency = (
    quotaDisplayType: 'USD' | 'CNY' | 'TOKENS' | 'CUSTOM'
  ) => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType,
        usdExchangeRate: 7,
        customCurrencySymbol: '¤',
        customCurrencyExchangeRate: 3,
      },
    })
  }

  test('uses billing currency for USD, CNY, custom, and token display modes', () => {
    const pricedModel = {
      ...model,
      enable_groups: ['pro'],
      group_ratio: { pro: 0.5 },
    }

    setCurrency('USD')
    assert.equal(formatPrice(pricedModel, 'input', 'M'), '$0.8')
    assert.equal(formatPrice(pricedModel, 'input', 'K'), '$0.0008')

    setCurrency('CNY')
    assert.equal(formatPrice(pricedModel, 'input', 'M'), '¥5.6')

    setCurrency('CUSTOM')
    assert.equal(formatPrice(pricedModel, 'input', 'M'), '¤ 2.4')

    setCurrency('TOKENS')
    assert.equal(formatPrice(pricedModel, 'input', 'M'), '$0.8')
  })
})

describe('dynamic pricing display', () => {
  test('formats multiplier ranges and token units', () => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
    })
    assert.equal(
      formatDynamicUnitPrice(2, {
        tokenUnit: 'M',
        ratioRange: { min: 0.4, max: 0.6 },
      }),
      '$0.8 ~ $1.2'
    )
    assert.equal(
      formatDynamicUnitPrice(2, {
        tokenUnit: 'K',
        ratioRange: { min: 0.5, max: 0.5 },
      }),
      '$0.001'
    )
  })

  test('keeps tiers, request rules, and special expressions distinct', () => {
    const dynamicModel: PricingModel = {
      ...model,
      billing_mode: 'tiered_expr',
      billing_expr:
        '(len <= 1000 ? tier("small", p * 2 + c * 4) : tier("large", p * 3 + c * 6)) * (has(header("x-fast"), "1") ? 2 : 1)',
    }
    const summary = getDynamicPricingSummary(dynamicModel, {
      tokenUnit: 'M',
      ratioRange: { min: 0.5, max: 1 },
    })
    assert.equal(summary?.tierCount, 2)
    assert.equal(summary?.hasRequestRules, true)
    assert.equal(summary?.isSpecialExpression, false)
    assert.equal(summary?.primaryEntries[0]?.formatted, '$1 ~ $2')

    const special = getDynamicPricingSummary(
      { ...dynamicModel, billing_expr: 'max(p, c) * 2' },
      { tokenUnit: 'M' }
    )
    assert.equal(special?.isSpecialExpression, true)
    assert.equal(special?.entries.length, 0)
  })
})
