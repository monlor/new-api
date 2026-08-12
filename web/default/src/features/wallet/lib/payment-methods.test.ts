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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  classifyPaymentMethod,
  sortPaymentMethods,
  type PaymentMethodItemModel,
} from './payment-methods'

describe('payment method classification', () => {
  test('prioritizes crypto, then card, before provider fallback', () => {
    assert.equal(
      classifyPaymentMethod({ type: 'usdt-card', provider: 'epay' }),
      'crypto'
    )
    assert.equal(
      classifyPaymentMethod({ name: 'Credit Card', provider: 'epay' }),
      'card'
    )
    assert.equal(
      classifyPaymentMethod({ type: 'alipay', provider: 'epay' }),
      'epay'
    )
    assert.equal(classifyPaymentMethod({ name: 'Bank transfer' }), 'normal')
  })
})

describe('payment method sorting', () => {
  test('uses the required category order and remains stable within categories', () => {
    const items: PaymentMethodItemModel[] = [
      { id: 'crypto-1', label: 'Crypto 1', category: 'crypto' },
      { id: 'epay-1', label: 'Epay 1', category: 'epay' },
      { id: 'normal-1', label: 'Normal 1', category: 'normal' },
      { id: 'card-1', label: 'Card 1', category: 'card' },
      { id: 'balance', label: 'Balance', category: 'balance' },
      { id: 'card-2', label: 'Card 2', category: 'card' },
      { id: 'epay-2', label: 'Epay 2', category: 'epay' },
      { id: 'crypto-2', label: 'Crypto 2', category: 'crypto' },
    ]

    assert.deepEqual(
      sortPaymentMethods(items).map((item) => item.id),
      [
        'balance',
        'card-1',
        'card-2',
        'epay-1',
        'epay-2',
        'normal-1',
        'crypto-1',
        'crypto-2',
      ]
    )
    assert.deepEqual(
      items.map((item) => item.id),
      [
        'crypto-1',
        'epay-1',
        'normal-1',
        'card-1',
        'balance',
        'card-2',
        'epay-2',
        'crypto-2',
      ]
    )
  })
})
