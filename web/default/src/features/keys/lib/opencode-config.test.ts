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
  OPENCODE_DEFAULT_CONTEXT,
  OPENCODE_DEFAULT_OUTPUT,
  OPENCODE_NPM_OPENAI_COMPATIBLE,
  buildOpenCodeConfig,
  buildOpenCodeProviderSettings,
  ensureOpenCodeModelFields,
  filterChatModels,
  getOpenCodeModelLimit,
  isChatModel,
  modelSupportsVision,
  normalizeOpenCodeBaseUrl,
  pickOpenCodeDefaultModel,
  pickOpenCodeSmallModel,
  toOpenCodeProviderId,
} from './opencode-config.ts'
import { endpointMapFromPricing } from './chat-models.ts'

describe('getOpenCodeModelLimit', () => {
  test('uses Claude family context and output limits', () => {
    assert.deepEqual(getOpenCodeModelLimit('claude-sonnet-4-5'), {
      context: 200_000,
      output: 64_000,
    })
    assert.deepEqual(getOpenCodeModelLimit('anthropic/claude-opus-4-6'), {
      context: 200_000,
      output: 32_000,
    })
    assert.deepEqual(getOpenCodeModelLimit('claude-haiku-4-5'), {
      context: 200_000,
      output: 64_000,
    })
  })

  test('uses GPT family limits including long-context GPT-5.4', () => {
    assert.deepEqual(getOpenCodeModelLimit('gpt-4o'), {
      context: 128_000,
      output: 16_384,
    })
    assert.deepEqual(getOpenCodeModelLimit('gpt-5.2-codex'), {
      context: 400_000,
      output: 128_000,
    })
    assert.deepEqual(getOpenCodeModelLimit('gpt-5.4'), {
      context: 1_050_000,
      output: 128_000,
    })
  })

  test('uses Gemini 1M context and parses explicit size from the model id', () => {
    assert.deepEqual(getOpenCodeModelLimit('gemini-2.5-pro'), {
      context: 1_048_576,
      output: 65_536,
    })
    assert.deepEqual(getOpenCodeModelLimit('local-qwen-128k'), {
      context: 128_000,
      output: 32_000,
    })
  })

  test('falls back to OpenCode catalog defaults for unknown models', () => {
    assert.deepEqual(getOpenCodeModelLimit('my-custom-coder'), {
      context: OPENCODE_DEFAULT_CONTEXT,
      output: OPENCODE_DEFAULT_OUTPUT,
    })
  })

  test('does not treat gpt-4o as an o-series model', () => {
    assert.deepEqual(getOpenCodeModelLimit('gpt-4o-mini'), {
      context: 128_000,
      output: 16_384,
    })
    assert.deepEqual(getOpenCodeModelLimit('o3-mini'), {
      context: 200_000,
      output: 100_000,
    })
  })
})

describe('buildOpenCodeConfig', () => {
  test('builds an OpenAI-compatible provider with per-model limits', () => {
    const json = buildOpenCodeConfig({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      providerName: 'New API',
      defaultModel: 'claude-sonnet-4-5',
      smallModel: 'claude-haiku-4-5',
      models: ['claude-sonnet-4-5', 'gpt-4o', 'claude-haiku-4-5'],
    })
    const parsed = JSON.parse(json) as {
      $schema: string
      model: string
      small_model: string
      provider: {
        'new-api': {
          npm: string
          options: { baseURL: string; apiKey: string }
          models: Record<
            string,
            {
              limit: { context: number; output: number }
              capabilities: { tools: boolean; input: string[] }
            }
          >
        }
      }
    }

    assert.equal(parsed.$schema, 'https://opencode.ai/config.json')
    assert.equal(parsed.model, 'new-api/claude-sonnet-4-5')
    assert.equal(parsed.small_model, 'new-api/claude-haiku-4-5')
    assert.equal(parsed.provider['new-api'].npm, OPENCODE_NPM_OPENAI_COMPATIBLE)
    assert.equal(
      parsed.provider['new-api'].options.baseURL,
      'https://api.example.com/v1'
    )
    assert.equal(parsed.provider['new-api'].options.apiKey, 'sk-test')
    assert.equal(
      parsed.provider['new-api'].models['claude-sonnet-4-5'].limit.context,
      200_000
    )
    assert.equal(parsed.provider['new-api'].models['gpt-4o'].limit.context, 128_000)
    assert.deepEqual(
      parsed.provider['new-api'].models['claude-sonnet-4-5'].capabilities.input,
      ['text', 'image']
    )
    assert.equal(
      parsed.provider['new-api'].models['claude-sonnet-4-5'].capabilities.tools,
      true
    )
  })

  test('does not duplicate /v1 on the base URL', () => {
    assert.equal(
      normalizeOpenCodeBaseUrl('https://api.example.com/v1/'),
      'https://api.example.com/v1'
    )
  })

  test('builds CC Switch settingsConfig with every selected model and limits', () => {
    const settings = buildOpenCodeProviderSettings({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      providerName: 'New API',
      defaultModel: 'claude-sonnet-4-5',
      smallModel: 'gpt-5.6-luna',
      models: ['claude-sonnet-4-5', 'gpt-5.2-chat-latest', 'gpt-5.6-luna'],
    })
    assert.equal(settings.model, 'new-api/claude-sonnet-4-5')
    assert.equal(settings.small_model, 'new-api/gpt-5.6-luna')
    const options = settings.options as Record<string, unknown>
    assert.equal(options.model, undefined)
    assert.equal(options.small_model, undefined)
    const ensured = JSON.parse(
      ensureOpenCodeModelFields(JSON.stringify({ provider: {} }), {
        providerName: 'New API',
        defaultModel: 'gpt-4o',
        smallModel: 'gpt-5.6-luna',
      })
    ) as { model: string; small_model: string }
    assert.equal(ensured.model, 'new-api/gpt-4o')
    assert.equal(ensured.small_model, 'new-api/gpt-5.6-luna')
    const models = settings.models as Record<
      string,
      { name: string; limit: { context: number; output: number } }
    >
    assert.equal(settings.npm, OPENCODE_NPM_OPENAI_COMPATIBLE)
    assert.deepEqual(Object.keys(models), [
      'claude-sonnet-4-5',
      'gpt-5.2-chat-latest',
      'gpt-5.6-luna',
    ])
    assert.equal(models['claude-sonnet-4-5'].limit.context, 200_000)
    assert.equal(models['gpt-5.2-chat-latest'].limit.context, 400_000)
  })

  test('slugifies provider ids and picks a small model', () => {
    assert.equal(toOpenCodeProviderId('My Gateway'), 'my-gateway')
    assert.equal(
      pickOpenCodeSmallModel(['gpt-4o', 'gpt-4o-mini'], 'gpt-4o'),
      'gpt-4o-mini'
    )
    assert.equal(
      pickOpenCodeSmallModel(
        ['claude-sonnet-4-5', 'gpt-5.6-luna', 'gpt-4o-mini'],
        'claude-sonnet-4-5'
      ),
      'gpt-5.6-luna'
    )
    assert.equal(modelSupportsVision('claude-sonnet-4-5'), true)
    assert.equal(modelSupportsVision('deepseek-chat'), false)
    assert.equal(
      pickOpenCodeDefaultModel([
        'gpt-4o-audio-preview',
        'claude-sonnet-4-5',
        'gpt-4o',
      ]),
      'claude-sonnet-4-5'
    )
  })
})

describe('isChatModel', () => {
  test('keeps chat and reasoning models, including vision chat models', () => {
    assert.equal(isChatModel('claude-sonnet-4-5'), true)
    assert.equal(isChatModel('gpt-4o'), true)
    assert.equal(isChatModel('gpt-5.4'), true)
    assert.equal(isChatModel('gemini-2.5-pro'), true)
    assert.equal(isChatModel('qwen2.5-vl'), true)
  })

  test('excludes image, embedding, video, and realtime models', () => {
    assert.equal(isChatModel('dall-e-3'), false)
    assert.equal(isChatModel('gpt-image-1'), false)
    assert.equal(isChatModel('text-embedding-3-small'), false)
    assert.equal(isChatModel('sora-2'), false)
    assert.equal(isChatModel('kling-v1'), false)
    assert.equal(isChatModel('gpt-4o-realtime-preview'), false)
    assert.equal(isChatModel('gpt-4o-audio-preview'), false)
    assert.equal(isChatModel('whisper-1'), false)
  })

  test('uses endpoint types when provided', () => {
    assert.equal(isChatModel('custom-model', ['image-generation']), false)
    assert.equal(isChatModel('custom-model', ['embeddings']), false)
    assert.equal(isChatModel('custom-model', ['openai']), true)
    assert.deepEqual(
      filterChatModels([
        'claude-sonnet-4-5',
        'dall-e-3',
        'text-embedding-3-small',
        'gpt-4o',
      ]),
      ['claude-sonnet-4-5', 'gpt-4o']
    )
    assert.deepEqual(
      filterChatModels(
        ['gpt-4o', 'dall-e-3', 'sora-2'],
        endpointMapFromPricing([
          { model_name: 'gpt-4o', supported_endpoint_types: ['openai'] },
          {
            model_name: 'dall-e-3',
            supported_endpoint_types: ['image-generation'],
          },
          { model_name: 'sora-2', supported_endpoint_types: ['openai-video'] },
        ])
      ),
      ['gpt-4o']
    )
  })
})
