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
import { resolveContentReviewPrompt } from './content-review-mode'

describe('resolveContentReviewPrompt', () => {
  test('uses the saved prompt when it has text', () => {
    assert.equal(
      resolveContentReviewPrompt('custom rules', 'built-in'),
      'custom rules'
    )
  })

  test('falls back to the built-in prompt when saved prompt is empty', () => {
    assert.equal(resolveContentReviewPrompt('', 'built-in'), 'built-in')
    assert.equal(resolveContentReviewPrompt('   \n', 'built-in'), 'built-in')
    assert.equal(resolveContentReviewPrompt(undefined, 'built-in'), 'built-in')
  })
})
