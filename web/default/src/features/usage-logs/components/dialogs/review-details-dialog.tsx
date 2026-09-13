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
import { useTranslation } from 'react-i18next'
import { formatLogQuota, formatTokens } from '@/lib/format'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { getContentReviewDecisionConfig } from '../../lib/review'
import type { ContentReviewLog } from '../../types'

function reviewModeLabel(mode?: string) {
  switch (mode) {
    case 'off':
      return 'Off'
    case 'async':
      return 'Async'
    case 'block':
      return 'Block'
    default:
      return mode || ''
  }
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value?: string | number | null
  mono?: boolean
}) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className='grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-2 text-xs'>
      <span className='text-muted-foreground pt-0.5'>{label}</span>
      <span className={mono ? 'font-mono break-all' : 'wrap-break-word'}>
        {value}
      </span>
    </div>
  )
}

export function ReviewDetailsDialog({
  log,
  open,
  onOpenChange,
}: {
  log: ContentReviewLog | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  if (!log) return null
  const decision = getContentReviewDecisionConfig(log.decision)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Review Details')}
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-3'
    >
      <div className='flex items-center gap-2'>
        <StatusBadge
          label={t(decision.label)}
          variant={decision.variant}
          size='sm'
          copyable={false}
        />
        {log.usage_missing && (
          <span className='text-muted-foreground text-xs'>
            {t('Usage missing')}
          </span>
        )}
      </div>
      <DetailRow label={t('Request ID')} value={log.request_id} mono />
      <DetailRow label={t('Username')} value={log.username} />
      <DetailRow label={t('Original Model')} value={log.original_model} mono />
      <DetailRow label={t('Review model')} value={log.review_model} mono />
      <DetailRow
        label={t('Channel')}
        value={log.channel_name || (log.channel ? `#${log.channel}` : '')}
      />
      <DetailRow
        label={t('Mode')}
        value={log.mode ? t(reviewModeLabel(log.mode)) : undefined}
      />
      <DetailRow
        label={t('Confidence')}
        value={log.confidence == null ? undefined : log.confidence.toFixed(2)}
        mono
      />
      <DetailRow label={t('Reason')} value={log.reason} />
      <DetailRow
        label={t('Prompt')}
        value={formatTokens(log.prompt_tokens ?? 0)}
        mono
      />
      <DetailRow
        label={t('Completion')}
        value={formatTokens(log.completion_tokens ?? 0)}
        mono
      />
      <DetailRow
        label={t('Estimated Cost')}
        value={formatLogQuota(log.estimated_quota ?? 0)}
        mono
      />
      <p className='text-muted-foreground text-[11px]'>
        {t('System overhead. This review call was not billed to the user.')}
      </p>
      <DetailRow
        label={t('Latency')}
        value={log.use_time_ms ? `${log.use_time_ms}ms` : undefined}
        mono
      />
      <DetailRow label={t('Group')} value={log.group} />
      {log.fail_message && (
        <div className='space-y-1'>
          <Label className='text-xs'>{t('Error Message')}</Label>
          <p className='text-destructive text-xs wrap-break-word'>
            {log.fail_message}
          </p>
        </div>
      )}
      {log.input_preview && (
        <div className='space-y-1'>
          <Label className='text-xs'>{t('Input Preview')}</Label>
          <p className='bg-muted/50 rounded-md border p-2 text-xs wrap-break-word'>
            {log.input_preview}
          </p>
        </div>
      )}
    </Dialog>
  )
}
