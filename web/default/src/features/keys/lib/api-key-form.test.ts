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
import { pickCreateApiKeyGroup } from './api-key-form.ts'

const groups = [
  { value: 'default' },
  { value: 'vip' },
  { value: 'auto' },
]

describe('pickCreateApiKeyGroup', () => {
  test('selects default when none is chosen', () => {
    assert.equal(pickCreateApiKeyGroup(groups), 'default')
  })

  test('keeps a valid current group', () => {
    assert.equal(
      pickCreateApiKeyGroup(groups, { currentGroup: 'vip' }),
      'vip'
    )
  })

  test('falls back to default when current is invalid', () => {
    assert.equal(
      pickCreateApiKeyGroup(groups, { currentGroup: 'missing' }),
      'default'
    )
  })

  test('prefers auto when defaultUseAutoGroup is enabled', () => {
    assert.equal(
      pickCreateApiKeyGroup(groups, { defaultUseAutoGroup: true }),
      'auto'
    )
  })

  test('ignores JSON key order when auto is first and the flag is off', () => {
    assert.equal(
      pickCreateApiKeyGroup(
        [{ value: 'auto' }, { value: 'default' }, { value: 'vip' }],
        { defaultUseAutoGroup: false }
      ),
      'default'
    )
  })

  test('skips auto when the flag is off and default is missing', () => {
    assert.equal(
      pickCreateApiKeyGroup([{ value: 'auto' }, { value: 'vip' }]),
      'vip'
    )
  })

  test('uses auto when it is the only available group', () => {
    assert.equal(pickCreateApiKeyGroup([{ value: 'auto' }]), 'auto')
  })

  test('selects the first group when auto is requested but unavailable', () => {
    assert.equal(
      pickCreateApiKeyGroup([{ value: 'vip' }, { value: 'pro' }], {
        defaultUseAutoGroup: true,
      }),
      'vip'
    )
  })

  test('returns empty string when no groups are available', () => {
    assert.equal(pickCreateApiKeyGroup([]), '')
  })
})
