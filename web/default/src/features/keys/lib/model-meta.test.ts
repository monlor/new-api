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
  modelSupportsReasoning,
  modelSupportsVision,
  normalizeCompatBaseUrl,
  uniqueModels,
} from './model-meta.ts'

describe('uniqueModels', () => {
  test('trims, drops blanks, and keeps first occurrence', () => {
    assert.deepEqual(uniqueModels([' gpt-5.5 ', '', 'grok-4.6', 'gpt-5.5']), [
      'gpt-5.5',
      'grok-4.6',
    ])
  })
})

describe('normalizeCompatBaseUrl', () => {
  test('appends /v1 once', () => {
    assert.equal(
      normalizeCompatBaseUrl('https://api.example.com'),
      'https://api.example.com/v1'
    )
    assert.equal(
      normalizeCompatBaseUrl('https://api.example.com/v1/'),
      'https://api.example.com/v1'
    )
  })
})

describe('modelSupportsReasoning', () => {
  test('marks common reasoning families and leaves gpt-4o off', () => {
    assert.equal(modelSupportsReasoning('claude-sonnet-4-5'), true)
    assert.equal(modelSupportsReasoning('gpt-5.4'), true)
    assert.equal(modelSupportsReasoning('o3-mini'), true)
    assert.equal(modelSupportsReasoning('gpt-4o'), false)
    assert.equal(modelSupportsReasoning('deepseek-chat'), false)
  })
})

describe('modelSupportsVision', () => {
  test('keeps chat vision families and drops text-only names', () => {
    assert.equal(modelSupportsVision('claude-sonnet-4-5'), true)
    assert.equal(modelSupportsVision('deepseek-chat'), false)
  })
})
