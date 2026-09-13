/*
Copyright (C) 2025 QuantumNous

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
import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  RadioGroup,
  Radio,
  Select,
  Input,
  Toast,
  Typography,
  Button,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { copy, selectFilter } from '../../../../helpers';

// Keep in sync with web/default/src/features/keys/lib/chat-models.ts
const NON_CHAT_NAME_RE =
  /embed|rerank|moderation|whisper|\btts\b|tts-|realtime|audio|voice|dall-?e|imagen|flux|midjourney|stable-?diffusion|sdxl|sora|\bveo\b|kling|pika|jimeng|cogview|cogvideo|hunyuan[-_]?video|\bwan[-_.]|gpt-image|seedream|vidu|runway|luma|hailuo|image-gen/i;

const OPENCODE_DEFAULT_CONTEXT = 200000;
const OPENCODE_DEFAULT_OUTPUT = 32000;
const OPENCODE_NPM_OPENAI_COMPATIBLE = '@ai-sdk/openai-compatible';
const OPENCODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json';
const DEFAULT_MODEL_RANK = [
  /claude.*sonnet/,
  /claude.*opus/,
  /gpt-5(?!.*audio)/,
  /gpt-4o(?!.*audio)/,
  /gemini/,
  /kimi/,
  /glm/,
  /deepseek/,
];

const APP_CONFIGS = {
  claude: {
    label: 'Claude',
    defaultName: 'My Claude',
    modelFields: [
      { key: 'model', label: '主模型' },
      { key: 'haikuModel', label: 'Haiku 模型' },
      { key: 'sonnetModel', label: 'Sonnet 模型' },
      { key: 'opusModel', label: 'Opus 模型' },
    ],
  },
  codex: {
    label: 'Codex',
    defaultName: 'My Codex',
    modelFields: [{ key: 'model', label: '主模型' }],
  },
  gemini: {
    label: 'Gemini',
    defaultName: 'My Gemini',
    modelFields: [{ key: 'model', label: '主模型' }],
  },
  opencode: {
    label: 'OpenCode',
    defaultName: 'My OpenCode',
    modelFields: [{ key: 'model', label: '主模型' }],
  },
};

function launchCCSwitch(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function getServerAddress() {
  try {
    const raw = localStorage.getItem('status');
    if (raw) {
      const status = JSON.parse(raw);
      if (status.server_address) return status.server_address;
    }
  } catch (_) {}
  return window.location.origin;
}

function normalizeOpenCodeBaseUrl(endpoint) {
  const trimmed = String(endpoint || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function toOpenCodeProviderId(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'newapi';
}

function uniqueModels(models, defaultModel) {
  const seen = new Set();
  const out = [];
  for (const model of [defaultModel, ...(models || [])]) {
    const id = String(model || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function pickOpenCodeDefaultModel(models) {
  const unique = uniqueModels(models, '');
  for (const pattern of DEFAULT_MODEL_RANK) {
    const match = unique.find((model) =>
      pattern.test(String(model).toLowerCase()),
    );
    if (match) return match;
  }
  return unique[0] ?? '';
}

function pickOpenCodeSmallModel(models, defaultModel) {
  const unique = uniqueModels(models, '');
  const preferred = unique.find(
    (model) =>
      model !== defaultModel && /gpt-5\.6-luna/i.test(String(model)),
  );
  if (preferred) return preferred;
  return unique.find(
    (model) =>
      model !== defaultModel &&
      /haiku|mini|flash|lite|nano|small/.test(String(model).toLowerCase()),
  );
}

function buildOpenCodeConfig({
  apiKey,
  baseUrl,
  providerName,
  defaultModel,
  smallModel,
  models,
}) {
  const providerId = toOpenCodeProviderId(providerName);
  const unique = uniqueModels(models, defaultModel);
  const modelEntries = {};
  for (const model of unique) {
    modelEntries[model] = {
      name: model,
      limit: {
        context: OPENCODE_DEFAULT_CONTEXT,
        output: OPENCODE_DEFAULT_OUTPUT,
      },
      capabilities: {
        tools: true,
        input: ['text'],
        output: ['text'],
      },
    };
  }
  const config = {
    $schema: OPENCODE_CONFIG_SCHEMA,
    provider: {
      [providerId]: {
        npm: OPENCODE_NPM_OPENAI_COMPATIBLE,
        name: providerName || providerId,
        options: {
          baseURL: normalizeOpenCodeBaseUrl(baseUrl),
          apiKey,
          setCacheKey: true,
        },
        models: modelEntries,
      },
    },
  };
  if (defaultModel) config.model = `${providerId}/${defaultModel}`;
  if (smallModel) config.small_model = `${providerId}/${smallModel}`;
  return JSON.stringify(config, null, 2);
}

function buildCCSwitchURL(app, name, models, apiKey) {
  const serverAddress = getServerAddress();
  const trimmed = serverAddress.replace(/\/+$/, '');
  const endpoint =
    app === 'codex' || app === 'opencode'
      ? normalizeOpenCodeBaseUrl(trimmed)
      : serverAddress;
  const params = new URLSearchParams();
  params.set('resource', 'provider');
  params.set('app', app);
  params.set('name', name);
  params.set('endpoint', endpoint);
  params.set('apiKey', apiKey);
  for (const [k, v] of Object.entries(models)) {
    if (v) params.set(k, v);
  }
  params.set('homepage', serverAddress);
  params.set('enabled', 'true');
  return `ccswitch://v1/import?${params.toString()}`;
}

export default function CCSwitchModal({
  visible,
  onClose,
  tokenKey,
  modelOptions,
}) {
  const { t } = useTranslation();
  const [app, setApp] = useState('claude');
  const [name, setName] = useState(APP_CONFIGS.claude.defaultName);
  const [models, setModels] = useState({});
  const [opencodeSelected, setOpencodeSelected] = useState([]);
  const [opencodeDefaultModel, setOpencodeDefaultModel] = useState('');
  const [opencodeSmallModel, setOpencodeSmallModel] = useState('');

  const currentConfig = APP_CONFIGS[app];
  const chatModelOptions = useMemo(
    () =>
      (modelOptions || []).filter(
        (item) => item?.value && !NON_CHAT_NAME_RE.test(String(item.value)),
      ),
    [modelOptions],
  );
  const chatModels = useMemo(
    () => chatModelOptions.map((item) => item.value),
    [chatModelOptions],
  );

  const applyOpenCodeDefaults = (modelIds) => {
    const defaultModel = pickOpenCodeDefaultModel(modelIds) || modelIds[0] || '';
    setOpencodeSelected(modelIds);
    setOpencodeDefaultModel(defaultModel);
    setOpencodeSmallModel(pickOpenCodeSmallModel(modelIds, defaultModel) || '');
  };

  useEffect(() => {
    if (visible) {
      setModels({});
      setApp('claude');
      setName(APP_CONFIGS.claude.defaultName);
      setOpencodeSelected([]);
      setOpencodeDefaultModel('');
      setOpencodeSmallModel('');
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || app !== 'opencode' || chatModels.length === 0) return;
    const nextDefault =
      pickOpenCodeDefaultModel(chatModels) || chatModels[0] || '';
    setOpencodeSelected((prev) => (prev.length === 0 ? chatModels : prev));
    setOpencodeDefaultModel((prev) =>
      prev && chatModels.includes(prev) ? prev : nextDefault,
    );
    setOpencodeSmallModel((prev) => {
      if (prev && chatModels.includes(prev)) return prev;
      return pickOpenCodeSmallModel(chatModels, nextDefault) || '';
    });
  }, [visible, app, chatModels]);

  const opencodeSettingsJson = useMemo(() => {
    if (app !== 'opencode') return '';
    const selected = opencodeSelected.filter(Boolean);
    if (selected.length === 0) return '';
    const key = String(tokenKey || '').startsWith('sk-')
      ? tokenKey
      : `sk-${tokenKey}`;
    const defaultModel =
      opencodeDefaultModel || pickOpenCodeDefaultModel(selected);
    return buildOpenCodeConfig({
      apiKey: key,
      baseUrl: getServerAddress(),
      providerName: name,
      defaultModel,
      smallModel: opencodeSmallModel,
      models: selected,
    });
  }, [
    app,
    tokenKey,
    name,
    opencodeSelected,
    opencodeDefaultModel,
    opencodeSmallModel,
  ]);

  const handleAppChange = (val) => {
    setApp(val);
    setName(APP_CONFIGS[val].defaultName);
    setModels({});
    if (val === 'opencode') {
      applyOpenCodeDefaults(chatModels);
    } else {
      setOpencodeSelected([]);
      setOpencodeDefaultModel('');
      setOpencodeSmallModel('');
    }
  };

  const handleModelChange = (field, value) => {
    setModels((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    const key = String(tokenKey || '').startsWith('sk-')
      ? tokenKey
      : `sk-${tokenKey}`;
    if (app === 'opencode') {
      const selected = opencodeSelected.filter(Boolean);
      if (selected.length === 0) {
        Toast.warning(t('请至少选择一个模型'));
        return;
      }
      const defaultModel =
        opencodeDefaultModel || pickOpenCodeDefaultModel(selected);
      const url = buildCCSwitchURL(app, name, { model: defaultModel }, key);
      launchCCSwitch(url);
      if (!opencodeSettingsJson) {
        Toast.error(t('复制失败'));
        return;
      }
      const copied = await copy(opencodeSettingsJson);
      if (!copied) {
        Toast.error(t('复制失败'));
        return;
      }
      Toast.success(
        t(
          '已打开 CC Switch，并复制完整模型 JSON。导入后请编辑供应商，粘贴到 Config JSON。',
        ),
      );
      onClose();
      return;
    }
    if (!models.model) {
      Toast.warning(t('请选择主模型'));
      return;
    }
    const url = buildCCSwitchURL(app, name, models, key);
    window.open(url, '_blank');
    onClose();
  };

  const fieldLabelStyle = useMemo(
    () => ({
      marginBottom: 4,
      fontSize: 13,
      color: 'var(--semi-color-text-1)',
    }),
    [],
  );

  return (
    <Modal
      title={t('填入 CC Switch')}
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={t('打开 CC Switch')}
      cancelText={t('取消')}
      maskClosable={false}
      width={app === 'opencode' ? 560 : 480}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={fieldLabelStyle}>{t('应用')}</div>
          <RadioGroup
            type='button'
            value={app}
            onChange={(e) => handleAppChange(e.target.value)}
            style={{ width: '100%' }}
          >
            {Object.entries(APP_CONFIGS).map(([key, cfg]) => (
              <Radio key={key} value={key}>
                {cfg.label}
              </Radio>
            ))}
          </RadioGroup>
        </div>

        <div>
          <div style={fieldLabelStyle}>{t('名称')}</div>
          <Input
            value={name}
            onChange={setName}
            placeholder={currentConfig.defaultName}
          />
        </div>

        {app === 'opencode' ? (
          <>
            <div>
              <div style={fieldLabelStyle}>
                {t('默认模型')}
                <Typography.Text type='danger'> *</Typography.Text>
              </div>
              <Select
                placeholder={t('请选择模型')}
                optionList={chatModelOptions}
                value={opencodeDefaultModel || undefined}
                onChange={(val) => {
                  setOpencodeDefaultModel(val);
                  if (val) {
                    setOpencodeSelected((prev) =>
                      prev.includes(val) ? prev : [...prev, val],
                    );
                  }
                }}
                filter={selectFilter}
                style={{ width: '100%' }}
                showClear
                searchable
                emptyContent={t('暂无数据')}
              />
            </div>
            <div>
              <div style={fieldLabelStyle}>{t('小模型')}</div>
              <Select
                placeholder={t('可选，用于生成标题')}
                optionList={chatModelOptions}
                value={opencodeSmallModel || undefined}
                onChange={(val) => {
                  setOpencodeSmallModel(val || '');
                  if (val) {
                    setOpencodeSelected((prev) =>
                      prev.includes(val) ? prev : [...prev, val],
                    );
                  }
                }}
                filter={selectFilter}
                style={{ width: '100%' }}
                showClear
                searchable
                emptyContent={t('暂无数据')}
              />
            </div>
            <div>
              <div
                style={{
                  ...fieldLabelStyle,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  {t('对话模型')}
                  <Typography.Text type='danger'> *</Typography.Text>
                </span>
                <span>
                  <Button
                    theme='borderless'
                    size='small'
                    onClick={() => setOpencodeSelected(chatModels)}
                  >
                    {t('全选')}
                  </Button>
                  <Button
                    theme='borderless'
                    size='small'
                    onClick={() => setOpencodeSelected([])}
                  >
                    {t('清空')}
                  </Button>
                </span>
              </div>
              <Select
                multiple
                placeholder={t('请选择模型')}
                optionList={chatModelOptions}
                value={opencodeSelected}
                onChange={(val) => setOpencodeSelected(val || [])}
                filter={selectFilter}
                style={{ width: '100%' }}
                showClear
                searchable
                emptyContent={t('暂无数据')}
                maxTagCount={6}
              />
              <Typography.Text type='tertiary' size='small'>
                {t('已排除图像、嵌入、视频和音频模型。')}
              </Typography.Text>
            </div>
            {opencodeSettingsJson ? (
              <div>
                <div
                  style={{
                    ...fieldLabelStyle,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{t('Config JSON')}</span>
                  <Button
                    theme='borderless'
                    size='small'
                    onClick={async () => {
                      const ok = await copy(opencodeSettingsJson);
                      if (ok) {
                        Toast.success(t('已复制到剪贴板'));
                      } else {
                        Toast.error(t('复制失败'));
                      }
                    }}
                  >
                    {t('复制 JSON')}
                  </Button>
                </div>
                <details
                  style={{
                    border: '1px solid var(--semi-color-border)',
                    borderRadius: 6,
                    padding: '6px 8px',
                    background: 'var(--semi-color-fill-0)',
                  }}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--semi-color-text-2)',
                    }}
                  >
                    {t('预览 JSON')}
                  </summary>
                  <pre
                    style={{
                      maxHeight: 160,
                      overflow: 'auto',
                      fontSize: 11,
                      lineHeight: 1.5,
                      margin: '8px 0 0',
                    }}
                  >
                    {opencodeSettingsJson}
                  </pre>
                </details>
                <Typography.Text type='tertiary' size='small'>
                  {t(
                    'CC Switch 目前只会从链接导入一个模型。点击导入后，请编辑供应商并把这段 JSON 粘贴到 Config JSON，然后保存。',
                  )}
                </Typography.Text>
              </div>
            ) : null}
          </>
        ) : (
          currentConfig.modelFields.map((field) => (
            <div key={field.key}>
              <div style={fieldLabelStyle}>
                {t(field.label)}
                {field.key === 'model' && (
                  <Typography.Text type='danger'> *</Typography.Text>
                )}
              </div>
              <Select
                placeholder={t('请选择模型')}
                optionList={chatModelOptions}
                value={models[field.key] || undefined}
                onChange={(val) => handleModelChange(field.key, val)}
                filter={selectFilter}
                style={{ width: '100%' }}
                showClear
                searchable
                emptyContent={t('暂无数据')}
              />
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
