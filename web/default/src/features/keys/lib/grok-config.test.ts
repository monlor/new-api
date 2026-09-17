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
  GROK_DEFAULT_EFFORTS,
  GROK_GPT_EFFORTS,
  buildGrokConfigToml,
  buildGrokEnvVars,
  grokConfigTomlPath,
  grokEffortsForModel,
  resolveGrokModel,
  resolveGrokModels,
} from './grok-config.ts'

describe('grokEffortsForModel', () => {
  test('gives GPT families extra ultra and leaves gpt-4o off', () => {
    assert.deepEqual(grokEffortsForModel('gpt-5.5'), [...GROK_GPT_EFFORTS])
    assert.deepEqual(grokEffortsForModel('gpt-5.3-codex-spark'), [
      ...GROK_GPT_EFFORTS,
    ])
    assert.deepEqual(grokEffortsForModel('o3-mini'), [...GROK_GPT_EFFORTS])
    assert.deepEqual(grokEffortsForModel('gpt-6-astra'), [...GROK_GPT_EFFORTS])
    assert.equal(grokEffortsForModel('gpt-4o'), undefined)
  })

  test('uses Grok CLI defaults for other reasoning families', () => {
    assert.deepEqual(grokEffortsForModel('grok-4.6'), [...GROK_DEFAULT_EFFORTS])
    assert.deepEqual(grokEffortsForModel('claude-sonnet-5'), [
      ...GROK_DEFAULT_EFFORTS,
    ])
  })
})

describe('resolveGrokModel', () => {
  test('skips unknown models', () => {
    assert.equal(resolveGrokModel('totally-unknown-coder'), null)
  })

  test('uses family context windows', () => {
    assert.equal(resolveGrokModel('claude-sonnet-5')?.context_window, 1_000_000)
    assert.equal(resolveGrokModel('claude-opus-5')?.context_window, 1_000_000)
    assert.equal(resolveGrokModel('claude-fable-5')?.context_window, 1_000_000)
    assert.equal(
      resolveGrokModel('claude-haiku-4-5-20251001')?.context_window,
      200_000
    )
    assert.equal(resolveGrokModel('gpt-5.6-luna')?.context_window, 1_050_000)
    assert.equal(resolveGrokModel('gpt-6-astra')?.context_window, 1_050_000)
    assert.equal(resolveGrokModel('grok-4.6')?.context_window, 500_000)
    assert.equal(resolveGrokModel('deepseek-v4-pro')?.context_window, 1_000_000)
    assert.equal(resolveGrokModel('glm-5.3')?.context_window, 1_000_000)
  })
})

describe('buildGrokConfigToml', () => {
  test('writes a flat config and skips unknown models', () => {
    const toml = buildGrokConfigToml({
      baseUrl: 'https://api.example.com',
      defaultModel: 'gpt-5.5',
      models: ['gpt-5.5', 'grok-4.6', 'mystery-model', 'gpt-4o'],
    })
    assert.match(toml, /\[endpoints\]/)
    assert.match(toml, /xai_api_base_url = "https:\/\/api.example.com\/v1"/)
    assert.match(toml, /default = "gpt-5.5"/)
    assert.match(toml, /\[model\."gpt-5.5"\]/)
    assert.match(toml, /\[model\."grok-4.6"\]/)
    assert.match(toml, /\[model\."gpt-4o"\]/)
    assert.equal(toml.includes('mystery-model'), false)
    assert.match(
      buildGrokConfigToml({
        baseUrl: 'https://api.example.com',
        defaultModel: 'gpt-6-astra',
        models: ['gpt-6-astra'],
      }),
      /\[model\."gpt-6-astra"\]/
    )
    assert.match(
      toml,
      /reasoning_efforts = \[\{ value = "minimal" \}, \{ value = "low" \}, \{ value = "medium" \}, \{ value = "high" \}, \{ value = "xhigh" \}, \{ value = "ultra" \}\]/
    )
    assert.equal(toml.includes('[[model.'), false)
    assert.match(
      toml,
      /\[model\."grok-4.6"\][\s\S]*supports_reasoning_effort = true/
    )
    assert.equal(
      /\[model\."grok-4.6"\][\s\S]*?reasoning_efforts/.test(toml),
      false
    )
    assert.equal(
      /\[model\."gpt-4o"\][\s\S]*?supports_reasoning_effort/.test(toml),
      false
    )
    assert.deepEqual(
      resolveGrokModels({
        baseUrl: 'https://api.example.com',
        defaultModel: 'gpt-5.5',
        models: ['gpt-5.5', 'mystery-model'],
      }).map((model) => model.id),
      ['gpt-5.5']
    )
  })

  test('omits [models].default when nothing resolves', () => {
    const toml = buildGrokConfigToml({
      baseUrl: 'https://api.example.com',
      defaultModel: 'mystery-model',
      models: ['also-unknown'],
    })
    assert.equal(/default = /.test(toml), false)
    assert.match(toml, /default_reasoning_effort = "medium"/)
    assert.equal(toml.includes('grok-4.6'), false)
  })
})

describe('buildGrokEnvVars', () => {
  test('sets key and XAI base URL; model list URL lives in config.toml', () => {
    assert.equal(
      buildGrokEnvVars('sk-test', 'https://api.example.com', 'unix'),
      [
        'export XAI_API_KEY="sk-test"',
        'export GROK_XAI_API_BASE_URL="https://api.example.com/v1"',
      ].join('\n')
    )
    assert.equal(grokConfigTomlPath('unix'), '~/.grok/config.toml')
  })
})
