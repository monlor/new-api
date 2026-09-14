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
import { nextCustomComboboxValue } from './combobox-input-commit.ts'

describe('nextCustomComboboxValue', () => {
  test('commits a trimmed custom value', () => {
    assert.equal(nextCustomComboboxValue('  sonnet  ', 'opus'), 'sonnet')
  })

  test('commits empty so optional fields can be cleared', () => {
    assert.equal(nextCustomComboboxValue('   ', 'claude-sonnet-4-5'), '')
  })

  test('skips when the trimmed value is unchanged', () => {
    assert.equal(nextCustomComboboxValue(' opus ', 'opus'), undefined)
    assert.equal(nextCustomComboboxValue('', ''), undefined)
  })
})
