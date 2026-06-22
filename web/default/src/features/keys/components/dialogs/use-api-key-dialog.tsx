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
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUserModels } from '@/lib/api'
import { useStatus } from '@/hooks/use-status'
import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import type { BundledLanguage } from 'shiki/bundle/web'
import { Dialog } from '@/components/dialog'

type ApiInfoEntry = { id: number; url: string; route: string }
type ClaudePlatform = 'unix' | 'win-cmd' | 'win-ps'
type CodexPlatform = 'unix' | 'windows'

function parseApiInfo(status: Record<string, unknown> | null): {
  apiInfoList: ApiInfoEntry[]
  serverAddress: string
} {
  const addr =
    (status?.server_address as string | undefined) ?? window.location.origin
  const rawList = status?.api_info
  const list: ApiInfoEntry[] = Array.isArray(rawList)
    ? (rawList as Record<string, unknown>[])
        .filter((item) => typeof item?.url === 'string' && item.url)
        .map((item, idx) => ({
          id: typeof item.id === 'number' ? item.id : idx,
          url: item.url as string,
          route: typeof item.route === 'string' ? item.route : '',
        }))
    : []
  return { apiInfoList: list, serverAddress: addr }
}

// ---------------------------------------------------------------------------
// Config builders
// ---------------------------------------------------------------------------

function buildClaudeCodeEnvVars(
  apiKey: string,
  baseUrl: string,
  model: string,
  platform: ClaudePlatform
): string {
  if (platform === 'win-cmd') {
    const lines = [
      `set ANTHROPIC_BASE_URL="${baseUrl}"`,
      `set ANTHROPIC_AUTH_TOKEN="${apiKey}"`,
      `set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
    ]
    if (model) lines.push(`set ANTHROPIC_MODEL="${model}"`)
    return lines.join('\n')
  }
  if (platform === 'win-ps') {
    const lines = [
      `$env:ANTHROPIC_BASE_URL="${baseUrl}"`,
      `$env:ANTHROPIC_AUTH_TOKEN="${apiKey}"`,
      `$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
    ]
    if (model) lines.push(`$env:ANTHROPIC_MODEL="${model}"`)
    return lines.join('\n')
  }
  const lines = [
    `export ANTHROPIC_BASE_URL="${baseUrl}"`,
    `export ANTHROPIC_AUTH_TOKEN="${apiKey}"`,
    `export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
  ]
  if (model) lines.push(`export ANTHROPIC_MODEL="${model}"`)
  return lines.join('\n')
}

function buildClaudeSettingsJson(
  apiKey: string,
  baseUrl: string,
  model: string
): string {
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }
  if (model) env.ANTHROPIC_MODEL = model
  return JSON.stringify({ env }, null, 2)
}

function buildCodexConfigToml(baseUrl: string, model: string): string {
  const modelVal = model || 'gpt-4o'
  return [
    `model_provider = "OpenAI"`,
    `model = "${modelVal}"`,
    `review_model = "${modelVal}"`,
    `model_reasoning_effort = "xhigh"`,
    `disable_response_storage = true`,
    `network_access = "enabled"`,
    ``,
    `[model_providers.OpenAI]`,
    `name = "OpenAI"`,
    `base_url = "${baseUrl}"`,
    `wire_api = "responses"`,
    `requires_openai_auth = true`,
    ``,
    `[features]`,
    `goals = true`,
  ].join('\n')
}

function buildCodexAuthJson(apiKey: string): string {
  return JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2)
}

function buildCurlCommand(apiKey: string, baseUrl: string, model: string): string {
  const effectiveModel = model || 'gpt-4o'
  const body = JSON.stringify({
    model: effectiveModel,
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: false,
  })
  return [
    `curl "${baseUrl}/v1/chat/completions" \\`,
    `  -H "Authorization: Bearer ${apiKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body}'`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FileConfigBlock(props: {
  label: string
  code: string
  lang: BundledLanguage | string
}) {
  return (
    <div className='space-y-1.5'>
      <code className='text-muted-foreground font-mono text-xs'>
        {props.label}
      </code>
      <CodeBlock
        code={props.code}
        language={props.lang}
        className='overflow-x-auto [&>div>div]:overflow-x-auto'
      >
        <CodeBlockCopyButton />
      </CodeBlock>
    </div>
  )
}

function WarningBanner(props: { children: React.ReactNode }) {
  return (
    <div className='flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'>
      <AlertCircle className='mt-0.5 size-3.5 shrink-0' />
      <span>{props.children}</span>
    </div>
  )
}

function InfoBanner(props: { children: React.ReactNode }) {
  return (
    <div className='flex items-start gap-2 rounded-lg border border-blue-200/70 bg-blue-50/70 px-3 py-2.5 text-xs text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'>
      <Info className='mt-0.5 size-3.5 shrink-0' />
      <span>{props.children}</span>
    </div>
  )
}

function SectionLabel(props: { children: React.ReactNode; variant?: 'warning' }) {
  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-medium ${
        props.variant === 'warning'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-muted-foreground'
      }`}
    >
      {props.variant === 'warning' && (
        <AlertCircle className='size-3.5 shrink-0' />
      )}
      {props.children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Platform tab styles (underline style like screenshots)
// ---------------------------------------------------------------------------

function PlatformTabs<T extends string>(props: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className='flex gap-0 border-b'>
      {props.options.map((opt) => (
        <button
          key={opt.value}
          type='button'
          onClick={() => props.onChange(opt.value)}
          className={`px-4 py-2 text-sm transition-colors ${
            props.value === opt.value
              ? 'border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenKey: string
}

export function UseApiKeyDialog(props: Props) {
  const { t } = useTranslation()
  const { status } = useStatus()

  const { apiInfoList, serverAddress } = useMemo(
    () => parseApiInfo(status as Record<string, unknown> | null),
    [status]
  )

  const [selectedEndpoint, setSelectedEndpoint] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [claudePlatform, setClaudePlatform] = useState<ClaudePlatform>('unix')
  const [codexPlatform, setCodexPlatform] = useState<CodexPlatform>('unix')

  const endpointOptions = useMemo(
    () =>
      apiInfoList.map((item) => ({
        value: item.url,
        label: item.route ? `${item.route} (${item.url})` : item.url,
      })),
    [apiInfoList]
  )

  const { data: modelsData } = useQuery({
    queryKey: ['user-models-use-api-key'],
    queryFn: getUserModels,
    enabled: props.open,
    staleTime: 5 * 60 * 1000,
  })

  const modelOptions = useMemo(() => {
    const items = modelsData?.data ?? []
    return items.map((m) => ({ value: m, label: m }))
  }, [modelsData?.data])

  // Reset on dialog open; model is left empty so the auto-select effect below
  // can fill it once modelOptions are ready.
  useEffect(() => {
    if (props.open) {
      setClaudePlatform('unix')
      setCodexPlatform('unix')
      setSelectedEndpoint('')
      setSelectedModel('')
    }
  }, [props.open])

  // Auto-select first endpoint as soon as apiInfoList is available and nothing is selected yet
  useEffect(() => {
    if (apiInfoList.length > 0 && !selectedEndpoint) {
      setSelectedEndpoint(apiInfoList[0].url)
    }
  }, [apiInfoList, selectedEndpoint])

  // Auto-select first model as soon as modelOptions is available and nothing is selected yet
  useEffect(() => {
    if (modelOptions.length > 0 && !selectedModel) {
      setSelectedModel(modelOptions[0].value)
    }
  }, [modelOptions, selectedModel])

  const apiKey = props.tokenKey.startsWith('sk-')
    ? props.tokenKey
    : `sk-${props.tokenKey}`

  // selectedEndpoint is always a real string (auto-filled from apiInfoList or server)
  const effectiveEndpoint = (
    selectedEndpoint || serverAddress
  ).replace(/\/$/, '')

  // Codex base_url includes /v1
  const codexBaseUrl = `${effectiveEndpoint}/v1`

  // Config strings
  const claudeEnvVars = buildClaudeCodeEnvVars(apiKey, effectiveEndpoint, selectedModel, claudePlatform)
  const claudeSettings = buildClaudeSettingsJson(apiKey, effectiveEndpoint, selectedModel)
  const codexConfigToml = buildCodexConfigToml(codexBaseUrl, selectedModel)
  const codexAuthJson = buildCodexAuthJson(apiKey)
  const curlCommand = buildCurlCommand(apiKey, effectiveEndpoint, selectedModel)

  const claudeSettingsPath =
    claudePlatform === 'unix'
      ? '~/.claude/settings.json'
      : '%userprofile%\\.claude\\settings.json'

  const codexConfigPath =
    codexPlatform === 'unix'
      ? '~/.codex/config.toml'
      : '%userprofile%\\.codex\\config.toml'

  const codexAuthPath =
    codexPlatform === 'unix'
      ? '~/.codex/auth.json'
      : '%userprofile%\\.codex\\auth.json'

  const claudeEnvBlockLabel =
    claudePlatform === 'unix'
      ? 'Terminal'
      : claudePlatform === 'win-cmd'
        ? 'Command Prompt'
        : 'PowerShell'

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Use API Key')}
      contentClassName='sm:max-w-2xl'
      contentHeight='auto'
      bodyClassName='space-y-4'
      initialFocus={false}
      footer={
        <Button variant='outline' onClick={() => props.onOpenChange(false)}>
          {t('Close')}
        </Button>
      }
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label>{t('API Endpoint')}</Label>
          <ComboboxInput
            options={endpointOptions}
            value={selectedEndpoint}
            onValueChange={setSelectedEndpoint}
            placeholder={t('Select or enter endpoint URL')}
            emptyText={t('No endpoints configured')}
            allowCustomValue
          />
        </div>
        <div className='space-y-2'>
          <Label>{t('Model')}</Label>
          <ComboboxInput
            options={modelOptions}
            value={selectedModel}
            onValueChange={setSelectedModel}
            placeholder={t('Select or enter model name')}
            emptyText={t('No models found')}
            allowCustomValue
          />
        </div>
      </div>

      <Tabs defaultValue='claude-code'>
        <TabsList className='bg-muted/60 gap-1 rounded-lg p-1'>
          <TabsTrigger value='claude-code' className='h-7 px-3 text-xs'>
            Claude Code
          </TabsTrigger>
          <TabsTrigger value='codex' className='h-7 px-3 text-xs'>
            Codex CLI
          </TabsTrigger>
          <TabsTrigger value='curl' className='h-7 px-3 text-xs'>
            cURL
          </TabsTrigger>
        </TabsList>

        {/* ── Claude Code ── */}
        <TabsContent value='claude-code' className='mt-0 space-y-0 outline-none'>
          <p className='text-muted-foreground py-3 text-xs'>
            {t(
              'Add the following environment variables to your terminal profile or run directly in terminal.'
            )}
          </p>

          <PlatformTabs
            value={claudePlatform}
            onChange={setClaudePlatform}
            options={[
              { value: 'unix', label: 'macOS / Linux' },
              { value: 'win-cmd', label: 'Windows CMD' },
              { value: 'win-ps', label: 'PowerShell' },
            ]}
          />

          <div className='space-y-4 pt-4'>
            <FileConfigBlock
              label={claudeEnvBlockLabel}
              code={claudeEnvVars}
              lang='bash'
            />

            <div className='space-y-1.5'>
              <SectionLabel variant='warning'>VSCode Claude Code</SectionLabel>
              <FileConfigBlock
                label={claudeSettingsPath}
                code={claudeSettings}
                lang='json'
              />
            </div>

            <InfoBanner>
              {t(
                'These environment variables take effect in the current terminal session. For permanent configuration, add them to ~/.bashrc, ~/.zshrc or the corresponding profile file.'
              )}
            </InfoBanner>
          </div>
        </TabsContent>

        {/* ── Codex CLI ── */}
        <TabsContent value='codex' className='mt-0 space-y-0 outline-none'>
          <p className='text-muted-foreground py-3 text-xs'>
            {t('Add the following config files to the Codex CLI config directory.')}
          </p>

          <PlatformTabs
            value={codexPlatform}
            onChange={setCodexPlatform}
            options={[
              { value: 'unix', label: 'macOS / Linux' },
              { value: 'windows', label: 'Windows' },
            ]}
          />

          <div className='space-y-4 pt-4'>
            <WarningBanner>
              {t(
                'Make sure the following content is at the beginning of the config.toml file.'
              )}
            </WarningBanner>

            <FileConfigBlock
              label={codexConfigPath}
              code={codexConfigToml}
              lang='toml'
            />

            <FileConfigBlock
              label={codexAuthPath}
              code={codexAuthJson}
              lang='json'
            />
          </div>
        </TabsContent>

        {/* ── cURL ── */}
        <TabsContent value='curl' className='mt-4 space-y-3 outline-none'>
          <FileConfigBlock label='Shell' code={curlCommand} lang='bash' />
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
