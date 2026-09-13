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
import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useStatus } from '@/hooks/use-status'
import { useChatModels } from '../../hooks/use-chat-models'
import {
  buildOpenCodeConfig,
  ensureOpenCodeModelFields,
  normalizeOpenCodeBaseUrl,
  pickOpenCodeDefaultModel,
  pickOpenCodeSmallModel,
} from '../../lib/opencode-config'
import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Label } from '@/components/ui/label'
import { MultiSelect } from '@/components/multi-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Dialog } from '@/components/dialog'

const APP_CONFIGS = {
  claude: {
    label: 'Claude',
    defaultName: 'My Claude',
    modelFields: [
      { key: 'model', labelKey: 'Primary Model', required: true },
      { key: 'haikuModel', labelKey: 'Haiku Model', required: false },
      { key: 'sonnetModel', labelKey: 'Sonnet Model', required: false },
      { key: 'opusModel', labelKey: 'Opus Model', required: false },
    ],
  },
  codex: {
    label: 'Codex',
    defaultName: 'My Codex',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  gemini: {
    label: 'Gemini',
    defaultName: 'My Gemini',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  opencode: {
    label: 'OpenCode',
    defaultName: 'My OpenCode',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
} as const

type AppType = keyof typeof APP_CONFIGS

type ApiInfoEntry = {
  id: number
  url: string
  route: string
}

function launchCCSwitch(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function buildCCSwitchURL(
  app: string,
  name: string,
  models: Record<string, string>,
  apiKey: string,
  apiEndpoint: string,
  homepage: string
): string {
  const endpoint =
    app === 'codex' || app === 'opencode'
      ? normalizeOpenCodeBaseUrl(apiEndpoint)
      : apiEndpoint
  const params = new URLSearchParams()
  params.set('resource', 'provider')
  params.set('app', app)
  params.set('name', name)
  params.set('endpoint', endpoint)
  params.set('apiKey', apiKey)
  for (const [k, v] of Object.entries(models)) {
    if (v) params.set(k, v)
  }
  params.set('homepage', homepage)
  params.set('enabled', 'true')
  return `ccswitch://v1/import?${params.toString()}`
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenKey: string
}

export function CCSwitchDialog(props: Props) {
  const { t } = useTranslation()
  const { systemName } = useSystemConfig()
  const systemNameRef = useRef(systemName)
  systemNameRef.current = systemName
  const [app, setApp] = useState<AppType>('claude')
  const [name, setName] = useState<string>(systemName)
  const [models, setModels] = useState<Record<string, string>>({})
  const [opencodeSelected, setOpencodeSelected] = useState<string[]>([])
  const [opencodeDefaultModel, setOpencodeDefaultModel] = useState('')
  const [opencodeSmallModel, setOpencodeSmallModel] = useState('')
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('')

  const { status } = useStatus()

  // Parse api_info and server_address from status response
  const { apiInfoList, serverAddress } = useMemo(() => {
    const raw = status as Record<string, unknown> | null
    const addr =
      (raw?.server_address as string | undefined) ?? window.location.origin
    const rawList = raw?.api_info
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
  }, [status])

  const endpointOptions = useMemo(
    () =>
      apiInfoList.map((item) => ({
        value: item.url,
        label: item.route ? `${item.route} (${item.url})` : item.url,
      })),
    [apiInfoList]
  )

  // Initialize selectedEndpoint when api_info loads or dialog opens
  useEffect(() => {
    if (!selectedEndpoint && apiInfoList.length > 0) {
      setSelectedEndpoint(apiInfoList[0].url)
    } else if (!selectedEndpoint && serverAddress) {
      setSelectedEndpoint(serverAddress)
    }
  }, [apiInfoList, serverAddress, selectedEndpoint])

  const { chatModels, chatModelOptions } = useChatModels(props.open)

  useEffect(() => {
    if (props.open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModels({})
      setOpencodeSelected([])
      setOpencodeDefaultModel('')
      setOpencodeSmallModel('')
      setApp('claude')

      setName(systemNameRef.current)

      // Reset to first configured endpoint on open
      setSelectedEndpoint(apiInfoList[0]?.url ?? serverAddress)
    }
    // systemNameRef, apiInfoList and serverAddress are stable refs or
    // derived from cached status — intentionally listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open])

  const currentConfig = APP_CONFIGS[app]

  const opencodeSettingsJson = useMemo(() => {
    if (app !== 'opencode') return ''
    const key = props.tokenKey.startsWith('sk-')
      ? props.tokenKey
      : `sk-${props.tokenKey}`
    const models = Array.from(
      new Set(
        [opencodeDefaultModel, opencodeSmallModel, ...opencodeSelected].filter(
          Boolean
        )
      )
    )
    try {
      return ensureOpenCodeModelFields(
        buildOpenCodeConfig({
          apiKey: key,
          baseUrl: selectedEndpoint || serverAddress,
          providerName: name,
          defaultModel: opencodeDefaultModel,
          smallModel: opencodeSmallModel,
          models,
        }),
        {
          providerName: name,
          defaultModel: opencodeDefaultModel,
          smallModel: opencodeSmallModel,
        }
      )
    } catch {
      return ''
    }
  }, [
    app,
    props.tokenKey,
    selectedEndpoint,
    serverAddress,
    name,
    opencodeSelected,
    opencodeDefaultModel,
    opencodeSmallModel,
  ])

  const handleAppChange = (val: string) => {
    const appVal = val as AppType
    setApp(appVal)
    setName(systemName)
    setModels({})
    setOpencodeSelected(appVal === 'opencode' ? chatModels : [])
    if (appVal === 'opencode') {
      const defaultModel =
        pickOpenCodeDefaultModel(chatModels) || chatModels[0] || ''
      setOpencodeDefaultModel(defaultModel)
      setOpencodeSmallModel(
        pickOpenCodeSmallModel(chatModels, defaultModel) ?? ''
      )
    } else {
      setOpencodeDefaultModel('')
      setOpencodeSmallModel('')
    }
  }

  useEffect(() => {
    if (app !== 'opencode' || chatModels.length === 0) return
    const nextDefault =
      pickOpenCodeDefaultModel(chatModels) || chatModels[0] || ''
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpencodeSelected((prev) => (prev.length === 0 ? chatModels : prev))
    setOpencodeDefaultModel((prev) =>
      prev && chatModels.includes(prev) ? prev : nextDefault
    )
    setOpencodeSmallModel((prev) => {
      if (prev && chatModels.includes(prev)) return prev
      return pickOpenCodeSmallModel(chatModels, nextDefault) ?? ''
    })
  }, [app, chatModels])

  const handleSubmit = async () => {
    const selectedOpenCodeModels = opencodeSelected.filter(Boolean)
    if (app === 'opencode') {
      if (selectedOpenCodeModels.length === 0) {
        toast.warning(t('Please select at least one model'))
        return
      }
    } else if (!models.model) {
      toast.warning(t('Please select a primary model'))
      return
    }
    const key = props.tokenKey.startsWith('sk-')
      ? props.tokenKey
      : `sk-${props.tokenKey}`
    const endpoint = selectedEndpoint || serverAddress
    const defaultModel =
      opencodeDefaultModel ||
      pickOpenCodeDefaultModel(selectedOpenCodeModels) ||
      selectedOpenCodeModels[0]
    const urlModels =
      app === 'opencode' ? { model: defaultModel } : models
    const url = buildCCSwitchURL(
      app,
      name,
      urlModels,
      key,
      endpoint,
      serverAddress
    )
    launchCCSwitch(url)
    if (app === 'opencode') {
      if (!opencodeSettingsJson) {
        toast.error(t('Copy failed'))
        return
      }
      const copied = await copyToClipboard(opencodeSettingsJson)
      if (!copied) {
        toast.error(t('Copy failed'))
        return
      }
      toast.success(
        t(
          'Opened CC Switch and copied the full model JSON. After import, edit the provider and paste it into Config JSON.'
        )
      )
      props.onOpenChange(false)
      return
    }
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Import to CC Switch')}
      contentClassName={app === 'opencode' ? 'sm:max-w-xl' : 'sm:max-w-md'}
      contentHeight='auto'
      bodyClassName={
        currentConfig.modelFields.length === 1 ? 'space-y-4 pb-52' : 'space-y-4'
      }
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit}>{t('Open CC Switch')}</Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='space-y-2'>
          <Label>{t('Application')}</Label>
          <RadioGroup
            value={app}
            onValueChange={handleAppChange}
            className='flex flex-wrap gap-4'
          >
            {(
              Object.entries(APP_CONFIGS) as [
                AppType,
                (typeof APP_CONFIGS)[AppType],
              ][]
            ).map(([key, cfg]) => (
              <div key={key} className='flex items-center gap-2'>
                <RadioGroupItem value={key} id={`app-${key}`} />
                <Label htmlFor={`app-${key}`} className='cursor-pointer'>
                  {cfg.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className='space-y-2'>
          <Label>{t('Name')}</Label>
          <ComboboxInput
            options={[]}
            value={name}
            onValueChange={setName}
            placeholder={systemName}
            emptyText=''
            allowCustomValue={true}
          />
        </div>

        <div className='space-y-2'>
          <Label>{t('API Endpoint')}</Label>
          <ComboboxInput
            options={endpointOptions}
            value={selectedEndpoint}
            onValueChange={setSelectedEndpoint}
            placeholder={t('Select or enter endpoint URL')}
            emptyText={t('No endpoints configured')}
            allowCustomValue={true}
          />
        </div>

        {app === 'opencode' ? (
          <div className='space-y-4'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label>
                  {t('Default model')}
                  <span className='text-destructive ml-0.5'>*</span>
                </Label>
                <ComboboxInput
                  options={chatModelOptions}
                  value={opencodeDefaultModel}
                  onValueChange={(value) => {
                    setOpencodeDefaultModel(value)
                    if (value) {
                      setOpencodeSelected((prev) =>
                        prev.includes(value) ? prev : [...prev, value]
                      )
                    }
                  }}
                  placeholder={t('Select or enter model name')}
                  emptyText={t('No models found')}
                  allowCustomValue
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('Small model')}</Label>
                <ComboboxInput
                  options={chatModelOptions}
                  value={opencodeSmallModel}
                  onValueChange={(value) => {
                    setOpencodeSmallModel(value)
                    if (value) {
                      setOpencodeSelected((prev) =>
                        prev.includes(value) ? prev : [...prev, value]
                      )
                    }
                  }}
                  placeholder={t('Optional, used for titles')}
                  emptyText={t('No models found')}
                  allowCustomValue
                />
              </div>
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between gap-2'>
                <Label>
                  {t('Chat models')}
                  <span className='text-destructive ml-0.5'>*</span>
                </Label>
                <div className='flex gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-muted-foreground h-7 px-2 text-xs'
                    onClick={() => setOpencodeSelected(chatModels)}
                  >
                    {t('Select all')}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-muted-foreground h-7 px-2 text-xs'
                    onClick={() => setOpencodeSelected([])}
                  >
                    {t('Clear selection')}
                  </Button>
                </div>
              </div>
              <MultiSelect
                options={chatModelOptions}
                selected={opencodeSelected}
                onChange={setOpencodeSelected}
                placeholder={t('Select or enter model name')}
                emptyText={t('No models found')}
                maxVisibleChips={6}
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Image, embedding, video, and audio models are excluded.'
                )}
              </p>
            </div>

            {opencodeSettingsJson ? (
              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <Label>{t('Config JSON')}</Label>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    onClick={async () => {
                      const ok = await copyToClipboard(opencodeSettingsJson)
                      if (ok) {
                        toast.success(t('Copied to clipboard'))
                      } else {
                        toast.error(t('Copy failed'))
                      }
                    }}
                  >
                    {t('Copy JSON')}
                  </Button>
                </div>
                <details className='bg-muted/50 rounded-md border'>
                  <summary className='text-muted-foreground cursor-pointer px-2 py-1.5 text-xs'>
                    {t('Preview JSON')}
                  </summary>
                  <pre className='max-h-40 overflow-auto p-2 text-[11px] leading-5'>
                    {opencodeSettingsJson}
                  </pre>
                </details>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'CC Switch currently imports only one model from the link. After clicking Import, open Edit Provider and paste this JSON into Config JSON, then Save.'
                  )}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          currentConfig.modelFields.map((field) => (
            <div key={field.key} className='space-y-2'>
              <Label>
                {t(field.labelKey)}
                {field.required && (
                  <span className='text-destructive ml-0.5'>*</span>
                )}
              </Label>
              <ComboboxInput
                options={chatModelOptions}
                value={models[field.key] || ''}
                onValueChange={(v) =>
                  setModels((prev) => ({ ...prev, [field.key]: v }))
                }
                placeholder={t('Select or enter model name')}
                emptyText={t('No models found')}
              />
            </div>
          ))
        )}
      </div>
    </Dialog>
  )
}
