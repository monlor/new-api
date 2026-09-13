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
  buildPiModelEntry,
  buildPiModelsJson,
  buildPiProvider,
  modelSupportsReasoning,
  toPiProviderId,
} from './pi-config.ts'

describe('toPiProviderId', () => {
  test('slugifies names and prefixes Pi built-in ids', () => {
    assert.equal(toPiProviderId('New API'), 'new-api')
    assert.equal(toPiProviderId('OpenAI'), 'newapi-openai')
    assert.equal(toPiProviderId('anthropic'), 'newapi-anthropic')
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
          apiKey: string
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
    assert.equal(provider.apiKey, 'sk-test')
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
      contextWindow: 200_000,
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
    assert.deepEqual(parsed.providers['new-api'], provider)
    assert.equal(parsed.providers.openai, undefined)
    assert.deepEqual(buildPiModelEntry('deepseek-chat').input, ['text'])
  })

  test('serializes empty key/models and round-trips quotes, backslashes, and newlines', () => {
    const empty = JSON.parse(
      buildPiModelsJson({
        apiKey: '',
        baseUrl: 'https://api.example.com',
        providerName: 'New API',
        models: [],
      })
    ) as {
      providers: { 'new-api': { apiKey: string; models: unknown[] } }
    }
    assert.equal(empty.providers['new-api'].apiKey, '')
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
          apiKey: string
          models: Array<{ id: string; name: string }>
        }
      >
    }
    const provider = parsed.providers[toPiProviderId(providerName)]
    assert.equal(provider.name, providerName)
    assert.equal(provider.apiKey, apiKey)
    assert.deepEqual(
      provider.models.map((model) => model.id),
      [modelId]
    )
    assert.equal(provider.models[0].name, modelId)
    assert.ok(json.includes(`"apiKey": ${JSON.stringify(apiKey)}`))
  })
})
