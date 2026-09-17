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
// ============================================================================
// Form Utilities
// ============================================================================
export {
  getApiKeyFormSchema,
  type ApiKeyFormValues,
  API_KEY_FORM_DEFAULT_VALUES,
  getApiKeyFormDefaultValues,
  pickCreateApiKeyGroup,
  transformFormDataToPayload,
  transformApiKeyToFormDefaults,
} from './api-key-form'
export {
  endpointMapFromPricing,
  filterChatModels,
  isChatModel,
} from './chat-models'
export {
  DEFAULT_MODEL_CONTEXT,
  DEFAULT_MODEL_OUTPUT,
  GPT_LONG_CONTEXT,
  getModelLimit,
  matchModelLimit,
  type ModelLimit,
} from './model-limits'
export {
  modelSupportsReasoning,
  modelSupportsVision,
  normalizeCompatBaseUrl,
  uniqueModels,
} from './model-meta'
export {
  GROK_DEFAULT_EFFORTS,
  GROK_DEFAULT_REASONING_EFFORT,
  GROK_GPT_EFFORTS,
  buildGrokConfigToml,
  buildGrokEnvVars,
  grokConfigTomlPath,
  grokEffortsForModel,
  resolveGrokModel,
  resolveGrokModels,
  type GrokConfigInput,
  type GrokModelOverride,
  type GrokPlatform,
} from './grok-config'
export {
  OPENCODE_DEFAULT_CONTEXT,
  OPENCODE_DEFAULT_OUTPUT,
  OPENCODE_NPM_OPENAI_COMPATIBLE,
  buildOpenCodeAuthJson,
  buildOpenCodeConfig,
  buildOpenCodeConfigParts,
  buildOpenCodeModelEntry,
  buildOpenCodeProviderSettings,
  pickOpenCodeDefaultModel,
  toOpenCodeAuthProviderId,
  toOpenCodeProviderId,
  openCodeAuthJsonPath,
  type OpenCodeConfigInput,
  type OpenCodeConfigParts,
  type OpenCodeModelEntry,
} from './opencode-config'
export {
  PI_API_OPENAI_COMPLETIONS,
  buildPiAuthJson,
  buildPiModelsJson,
  buildPiProvider,
  toPiAuthProviderId,
  toPiProviderId,
  type PiConfigInput,
  type PiModelInput,
} from './pi-config'
