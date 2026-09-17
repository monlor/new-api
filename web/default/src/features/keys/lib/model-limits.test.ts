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
  DEFAULT_MODEL_CONTEXT,
  GPT_LONG_CONTEXT,
  getModelLimit,
  matchModelLimit,
} from './model-limits.ts'

describe('getModelLimit', () => {
  test('matches Claude, GPT 5.6+, Grok, DeepSeek, and GLM families', () => {
    assert.deepEqual(getModelLimit('claude-sonnet-5'), {
      context: 1_000_000,
      output: 64_000,
    })
    assert.deepEqual(getModelLimit('claude-opus-5'), {
      context: 1_000_000,
      output: 32_000,
    })
    assert.deepEqual(getModelLimit('claude-fable-5'), {
      context: 1_000_000,
      output: 32_000,
    })
    assert.deepEqual(getModelLimit('claude-haiku-4-5-20251001'), {
      context: 200_000,
      output: 64_000,
    })
    assert.deepEqual(getModelLimit('gpt-5.4'), {
      context: GPT_LONG_CONTEXT,
      output: 128_000,
    })
    assert.deepEqual(getModelLimit('gpt-5.2-codex'), {
      context: 400_000,
      output: 128_000,
    })
    assert.deepEqual(getModelLimit('gpt-5.6-luna'), {
      context: GPT_LONG_CONTEXT,
      output: 128_000,
    })
    assert.deepEqual(getModelLimit('gpt-6-astra'), {
      context: GPT_LONG_CONTEXT,
      output: 128_000,
    })
    assert.deepEqual(getModelLimit('grok-4.6'), {
      context: 500_000,
      output: 32_768,
    })
    assert.deepEqual(getModelLimit('deepseek-v4-pro'), {
      context: 1_000_000,
      output: 32_000,
    })
    assert.deepEqual(getModelLimit('glm-5.3'), {
      context: 1_000_000,
      output: 32_000,
    })
  })

  test('falls back for unknown models and parses size from the id', () => {
    assert.equal(matchModelLimit('totally-unknown-coder'), null)
    assert.deepEqual(getModelLimit('totally-unknown-coder'), {
      context: DEFAULT_MODEL_CONTEXT,
      output: 32_000,
    })
    assert.deepEqual(getModelLimit('local-qwen-128k'), {
      context: 128_000,
      output: 32_000,
    })
  })
})
