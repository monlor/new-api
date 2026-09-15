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
import { Sparkles, Check, Coins, Info, Gem } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/status-badge'
import {
  formatEstimatedCallCount,
  formatFixedUsd,
  AVG_PROMPT_TOKENS_PER_CALL,
  AVG_COMPLETION_TOKENS_PER_CALL,
} from '@/features/subscriptions/lib'
import type { PlanCardModel } from '@/features/subscriptions/lib/plan-card-model'

function formatSeriesLabel(series: string): string {
  if (!series) return ''
  if (series.length <= 3) return series.toUpperCase()
  return series.charAt(0).toUpperCase() + series.slice(1)
}

interface PlanPurchaseCardProps {
  model: PlanCardModel
  onSubscribe: () => void
}

export function PlanPurchaseCard(props: PlanPurchaseCardProps) {
  const { t } = useTranslation()
  const model = props.model

  return (
    <div
      className={cn(
        'group bg-card relative flex flex-col overflow-hidden rounded-2xl border transition-colors duration-200',
        'border-foreground/10 hover:border-foreground/25',
        model.isRecommended &&
          'border-foreground/20 hover:border-foreground/35 border-2'
      )}
    >
      <div className='flex flex-1 flex-col p-5 sm:p-6'>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <h4 className='truncate text-base font-semibold tracking-tight'>
              {model.title}
            </h4>
            {model.subtitle && (
              <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
                {model.subtitle}
              </p>
            )}
          </div>
          {model.isRecommended && (
            <StatusBadge variant='info' copyable={false} className='shrink-0'>
              <Sparkles className='h-3 w-3' />
              {t('Recommended')}
            </StatusBadge>
          )}
        </div>

        <div className='mt-5 flex flex-wrap items-end gap-x-1.5 gap-y-2'>
          <span className='text-foreground text-3xl leading-none font-bold tracking-tight whitespace-nowrap'>
            {formatCurrencyFromUSD(model.price)}
          </span>
          <span className='text-muted-foreground truncate pb-0.5 text-xs'>
            / {model.durationLabel}
          </span>
          {model.savePercent !== null && (
            <StatusBadge
              variant='success'
              copyable={false}
              className='mb-0.5 shrink-0'
              label={t('Save {{percent}}%', { percent: model.savePercent })}
            />
          )}
        </div>

        <div className='mt-5'>
          {model.reached ? (
            <Tooltip>
              <TooltipTrigger render={<div />}>
                <Button className='w-full' disabled>
                  {t('Limit Reached')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('Purchase limit reached')} ({model.count}/{model.limit})
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant={model.isRecommended ? 'default' : 'outline'}
              className='w-full'
              onClick={props.onSubscribe}
            >
              {t('Subscribe Now')}
            </Button>
          )}
        </div>

        <Separator className='my-5' />

        <div className='flex flex-1 flex-col gap-2'>
          {model.benefits.map((label) => (
            <div
              key={label}
              className='flex items-start gap-2 text-xs leading-5'
            >
              <span className='bg-primary/10 text-primary mt-px flex size-4 shrink-0 items-center justify-center rounded-full'>
                <Check className='size-2.5' strokeWidth={3} />
              </span>
              <span className='text-muted-foreground'>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {model.modelValues.length > 0 && (
        <div className='bg-muted/40 border-t px-5 py-4 sm:px-6'>
          <div className='text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase'>
            <Coins className='size-3.5' />
            <span>{t('Estimated calls per model')}</span>
            <Tooltip>
              <TooltipTrigger render={<span className='cursor-help' />}>
                <Info className='size-3' />
              </TooltipTrigger>
              <TooltipContent>
                {t(
                  'Rough estimate of how many calls this plan quota covers for each model, assuming {{prompt}} prompt tokens + {{completion}} completion tokens per call on average. Actual usage will vary.',
                  {
                    prompt: AVG_PROMPT_TOKENS_PER_CALL,
                    completion: AVG_COMPLETION_TOKENS_PER_CALL,
                  }
                )}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className='mt-2.5 flex flex-wrap gap-1.5'>
            {model.modelValues.map((item) => (
              <span
                key={item.modelName}
                className='bg-background ring-foreground/10 inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-[11px] ring-1'
              >
                <span className='text-foreground max-w-[10rem] truncate font-medium'>
                  {item.modelName}
                </span>
                <span className='text-primary font-semibold tabular-nums'>
                  {item.callCount == null
                    ? t('Unlimited')
                    : t('≈ {{calls}} calls', {
                        calls: formatEstimatedCallCount(item.callCount),
                      })}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {model.seriesValues.length > 0 && (
        <div className='bg-muted/40 border-t px-5 py-4 sm:px-6'>
          <div className='text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase'>
            <Gem className='size-3.5' />
            <span>{t('Series raw value')}</span>
            <Tooltip>
              <TooltipTrigger render={<span className='cursor-help' />}>
                <Info className='size-3' />
              </TooltipTrigger>
              <TooltipContent>
                {t(
                  "Estimated USD value of this plan quota if converted to the equivalent quota on each model family's official API (e.g. OpenAI, Anthropic). Always shown in USD."
                )}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className='mt-2.5 flex flex-wrap gap-1.5'>
            {model.seriesValues.map((item) => (
              <span
                key={item.series}
                className='bg-background ring-foreground/10 inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-[11px] ring-1'
              >
                <span className='text-foreground max-w-[10rem] truncate font-medium'>
                  {formatSeriesLabel(item.series)}
                </span>
                <span className='text-primary font-semibold tabular-nums'>
                  ≈ {formatFixedUsd(item.value)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
