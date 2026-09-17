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
  PI_API_OPENAI_COMPLETIONS,
  buildPiAuthJson,
  buildPiModelEntry,
  buildPiModelsJson,
  buildPiProvider,
  toPiProviderId,
} from './pi-config.ts'

describe('toPiProviderId', () => {
  test('slugifies names and prefixes Pi built-in ids', () => {
    assert.equal(toPiProviderId('New API'), 'new-api')
    assert.equal(toPiProviderId('OpenAI'), 'newapi-openai')
    assert.equal(toPiProviderId('anthropic'), 'newapi-anthropic')
    assert.equal(toPiProviderId('MiniMax'), 'newapi-minimax')
    assert.equal(toPiProviderId('ZAI'), 'newapi-zai')
    assert.equal(toPiProviderId('GitHub Copilot'), 'newapi-github-copilot')
  })
})

describe('buildPiModelsJson', () => {
  test('writes a full models.json with OpenAI-compatible defaults', () => {
    const json = buildPiModelsJson({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      providerName: 'New API',
      models: ['claude-sonnet-4-5', 'gpt-4o', 'claude-sonnet-4-5'],
    })
    const parsed = JSON.parse(json) as {
      providers: {
        'new-api': {
          name: string
          baseUrl: string
          api: string
          apiKey?: string
          compat: {
            supportsDeveloperRole: boolean
            supportsReasoningEffort: boolean
          }
          models: Array<{
            id: string
            name: string
            reasoning: boolean
            input: string[]
            contextWindow: number
            maxTokens: number
          }>
        }
      }
    }

    const provider = parsed.providers['new-api']
    assert.equal(provider.name, 'New API')
    assert.equal(provider.baseUrl, 'https://api.example.com/v1')
    assert.equal(provider.api, PI_API_OPENAI_COMPLETIONS)
    assert.equal(provider.apiKey, undefined)
    assert.equal(provider.compat.supportsDeveloperRole, false)
    assert.equal(provider.compat.supportsReasoningEffort, false)
    assert.deepEqual(
      provider.models.map((model) => model.id),
      ['claude-sonnet-4-5', 'gpt-4o']
    )
    assert.deepEqual(provider.models[0], {
      id: 'claude-sonnet-4-5',
      name: 'claude-sonnet-4-5',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_000_000,
      maxTokens: 64_000,
    })
    assert.equal(provider.models[1].contextWindow, 128_000)
    assert.equal(provider.models[1].reasoning, false)
    assert.deepEqual(provider.models[1].input, ['text', 'image'])
  })

  test('does not wrap a second /v1 and keeps the provider fragment separate', () => {
    const input = {
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1/',
      providerName: 'New API',
      models: ['deepseek-chat'],
    }
    const provider = buildPiProvider(input)
    const parsed = JSON.parse(buildPiModelsJson(input)) as {
      providers: Record<string, unknown>
    }
    assert.equal(provider.baseUrl, 'https://api.example.com/v1')
    assert.equal('apiKey' in provider, false)
    assert.deepEqual(parsed.providers['new-api'], provider)
    assert.equal(parsed.providers.openai, undefined)
    assert.deepEqual(buildPiModelEntry('deepseek-chat').input, ['text'])
  })

  test('serializes empty models and round-trips quotes, backslashes, and newlines', () => {
    const empty = JSON.parse(
      buildPiModelsJson({
        apiKey: '',
        baseUrl: 'https://api.example.com',
        providerName: 'New API',
        models: [],
      })
    ) as {
      providers: { 'new-api': { apiKey?: string; models: unknown[] } }
    }
    assert.equal(empty.providers['new-api'].apiKey, undefined)
    assert.deepEqual(empty.providers['new-api'].models, [])

    const apiKey = 'sk-"quoted"\\slash\nline'
    const providerName = 'Name "x"\\y\nz'
    const modelId = 'model-"a"\\b\nc'
    const json = buildPiModelsJson({
      apiKey,
      baseUrl: 'https://api.example.com',
      providerName,
      models: [modelId, '  ', modelId],
    })
    const parsed = JSON.parse(json) as {
      providers: Record<
        string,
        {
          name: string
          apiKey?: string
          models: Array<{ id: string; name: string }>
        }
      >
    }
    const provider = parsed.providers[toPiProviderId(providerName)]
    assert.equal(provider.name, providerName)
    assert.equal(provider.apiKey, undefined)
    assert.deepEqual(
      provider.models.map((model) => model.id),
      [modelId]
    )
    assert.equal(provider.models[0].name, modelId)
    assert.equal(json.includes('"apiKey"'), false)
  })
})

describe('buildPiAuthJson', () => {
  test('writes the official api_key credential keyed by provider id', () => {
    const json = buildPiAuthJson({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      providerName: 'New API',
      models: ['gpt-4o'],
    })
    assert.deepEqual(JSON.parse(json), {
      'new-api': { type: 'api_key', key: 'sk-test' },
    })
  })

  test('prefixes reserved ids and round-trips quotes, backslashes, and newlines', () => {
    const apiKey = 'sk-"quoted"\\slash\nline'
    const json = buildPiAuthJson({
      apiKey,
      baseUrl: 'https://api.example.com',
      providerName: 'OpenAI',
      models: [],
    })
    const parsed = JSON.parse(json) as Record<
      string,
      { type: string; key: string }
    >
    assert.deepEqual(parsed['newapi-openai'], {
      type: 'api_key',
      key: apiKey,
    })
    assert.ok(json.includes(`"key": ${JSON.stringify(apiKey)}`))
    assert.equal(parsed.minimax, undefined)
    assert.deepEqual(
      JSON.parse(
        buildPiAuthJson({
          apiKey: 'sk-minimax',
          baseUrl: 'https://api.example.com',
          providerName: 'MiniMax',
          models: [],
        })
      ),
      { 'newapi-minimax': { type: 'api_key', key: 'sk-minimax' } }
    )
  })
})
