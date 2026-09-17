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
import { endpointMapFromPricing } from './chat-models.ts'
import { modelSupportsVision, normalizeCompatBaseUrl } from './model-meta.ts'
import {
  OPENCODE_NPM_OPENAI_COMPATIBLE,
  buildOpenCodeAuthJson,
  buildOpenCodeConfig,
  buildOpenCodeConfigParts,
  buildOpenCodeProviderSettings,
  filterChatModels,
  isChatModel,
  pickOpenCodeDefaultModel,
  pickOpenCodeSmallModel,
  openCodeAuthJsonPath,
  toOpenCodeProviderId,
} from './opencode-config.ts'

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
          options: { baseURL: string; apiKey?: string }
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
    const withoutSmall = JSON.parse(
      buildOpenCodeConfig({
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com',
        providerName: 'New API',
        defaultModel: 'claude-sonnet-4-5',
        models: ['claude-sonnet-4-5', 'gpt-4o'],
      })
    ) as { small_model?: string }
    assert.equal(withoutSmall.small_model, undefined)
    assert.equal(parsed.provider['new-api'].npm, OPENCODE_NPM_OPENAI_COMPATIBLE)
    assert.equal(
      parsed.provider['new-api'].options.baseURL,
      'https://api.example.com/v1'
    )
    assert.equal(parsed.provider['new-api'].options.apiKey, undefined)
    assert.equal(
      parsed.provider['new-api'].models['claude-sonnet-4-5'].limit.context,
      1_000_000
    )
    assert.equal(
      parsed.provider['new-api'].models['gpt-4o'].limit.context,
      128_000
    )
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
      normalizeCompatBaseUrl('https://api.example.com/v1/'),
      'https://api.example.com/v1'
    )
  })

  test('builds CC Switch settingsConfig with every selected model and limits', () => {
    const input = {
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      providerName: 'New API',
      defaultModel: 'claude-sonnet-4-5',
      smallModel: 'gpt-5.6-luna',
      models: ['claude-sonnet-4-5', 'gpt-5.2-chat-latest', 'gpt-5.6-luna'],
    }
    const { provider, settings, config } = buildOpenCodeConfigParts(input)
    assert.deepEqual(buildOpenCodeProviderSettings(input), settings)
    const fullConfig = JSON.parse(buildOpenCodeConfig(input)) as {
      model: string
      small_model: string
      provider: { 'new-api': Record<string, unknown> }
      npm?: unknown
      options?: unknown
    }
    assert.deepEqual(fullConfig, config)
    assert.equal(settings.npm, OPENCODE_NPM_OPENAI_COMPATIBLE)
    assert.equal(settings.model, 'new-api/claude-sonnet-4-5')
    assert.equal(settings.small_model, 'new-api/gpt-5.6-luna')
    assert.equal(config.model, settings.model)
    assert.equal(config.small_model, settings.small_model)
    assert.deepEqual(fullConfig.provider['new-api'], provider)
    assert.equal(provider.model, undefined)
    assert.equal(provider.small_model, undefined)
    assert.equal(fullConfig.npm, undefined)
    assert.equal(fullConfig.options, undefined)
    assert.equal(settings.$schema, undefined)
    assert.equal(settings.provider, undefined)
    const options = settings.options as Record<string, unknown>
    assert.equal(options.model, undefined)
    assert.equal(options.small_model, undefined)
    assert.equal(options.baseURL, 'https://api.example.com/v1')
    assert.equal(options.apiKey, 'sk-test')
    const configOptions = fullConfig.provider['new-api'].options as {
      apiKey?: string
    }
    assert.equal(configOptions.apiKey, undefined)
    const models = settings.models as Record<
      string,
      { name: string; limit: { context: number; output: number } }
    >
    assert.equal(settings.npm, OPENCODE_NPM_OPENAI_COMPATIBLE)
    assert.equal(settings.name, 'New API')
    assert.deepEqual(Object.keys(models), [
      'claude-sonnet-4-5',
      'gpt-5.2-chat-latest',
      'gpt-5.6-luna',
    ])
    assert.equal(models['claude-sonnet-4-5'].limit.context, 1_000_000)
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

describe('buildOpenCodeAuthJson', () => {
  test('writes the official api credential keyed by provider id', () => {
    const json = buildOpenCodeAuthJson({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      providerName: 'New API',
      defaultModel: 'gpt-4o',
      models: ['gpt-4o'],
    })
    assert.deepEqual(JSON.parse(json), {
      'new-api': { type: 'api', key: 'sk-test' },
    })
  })

  test('round-trips quotes, backslashes, and newlines in the key', () => {
    const apiKey = 'sk-"quoted"\\slash\nline'
    const json = buildOpenCodeAuthJson({
      apiKey,
      baseUrl: 'https://api.example.com',
      providerName: 'New API',
      defaultModel: 'gpt-4o',
      models: [],
    })
    const parsed = JSON.parse(json) as Record<
      string,
      { type: string; key: string }
    >
    assert.deepEqual(parsed['new-api'], { type: 'api', key: apiKey })
    assert.ok(json.includes(`"key": ${JSON.stringify(apiKey)}`))
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

describe('openCodeAuthJsonPath', () => {
  test('uses the XDG data directory on Windows, not LOCALAPPDATA cache', () => {
    assert.equal(
      openCodeAuthJsonPath('unix'),
      '~/.local/share/opencode/auth.json'
    )
    assert.equal(
      openCodeAuthJsonPath('windows'),
      '%userprofile%\\.local\\share\\opencode\\auth.json'
    )
  })
})
