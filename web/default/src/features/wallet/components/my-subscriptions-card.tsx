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
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import {
  RefreshCw,
  ExternalLink,
  Loader2,
  ListChecks,
  ArrowRight,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/status-badge'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
  createStripePortalSession,
} from '@/features/subscriptions/api'
import { planHasReset, calcEstimatedTotal } from '@/features/subscriptions/lib'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

/** Subscriptions whose end time is older than this window are hidden by default. */
const RECENT_WINDOW_DAYS = 90
const SECONDS_PER_DAY = 86400

interface MySubscriptionsCardProps {
  onAvailabilityChange?: (hasAny: boolean) => void
}

export function MySubscriptionsCard(props: MySubscriptionsCardProps) {
  const { t } = useTranslation()
  const onAvailabilityChange = props.onAvailabilityChange

  const [planTitleMap, setPlanTitleMap] = useState<Map<number, string>>(
    new Map()
  )
  const [planHasResetMap, setPlanHasResetMap] = useState<Map<number, boolean>>(
    new Map()
  )
  const [planEstTotalMap, setPlanEstTotalMap] = useState<
    Map<number, number | null>
  >(new Map())
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [currentTimestamp, setCurrentTimestamp] = useState(
    () => Date.now() / 1000
  )
  const [managingSubscriptionId, setManagingSubscriptionId] = useState<
    number | null
  >(null)
  const [showAll, setShowAll] = useState(false)

  const fetchPlanMaps = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (res.success) {
        const titleMap = new Map<number, string>()
        const hasResetMap = new Map<number, boolean>()
        const estTotalMap = new Map<number, number | null>()
        for (const p of res.data || []) {
          const plan = p?.plan
          if (!plan?.id) continue
          titleMap.set(plan.id, plan.title || '')
          hasResetMap.set(plan.id, planHasReset(plan))
          estTotalMap.set(plan.id, calcEstimatedTotal(plan))
        }
        setPlanTitleMap(titleMap)
        setPlanHasResetMap(hasResetMap)
        setPlanEstTotalMap(estTotalMap)
      }
    } catch {
      // ignore — plan titles are a display nicety, not critical
    }
  }, [])

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (res.success && res.data) {
        setAllSubscriptions(res.data.all_subscriptions || [])
      }
    } catch {
      // ignore
    } finally {
      setCurrentTimestamp(Date.now() / 1000)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTimestamp(Date.now() / 1000)
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlanMaps(), fetchSelfSubscription()])
      setLoading(false)
    }
    init()
  }, [fetchPlanMaps, fetchSelfSubscription])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchSelfSubscription()
    } finally {
      setRefreshing(false)
    }
  }

  const handleManageStripeSubscription = async (subscriptionId: number) => {
    setManagingSubscriptionId(subscriptionId)
    const portalWindow = window.open('', '_blank')
    if (portalWindow) portalWindow.opener = null

    try {
      const res = await createStripePortalSession(subscriptionId)
      const portalUrl = res.data?.portal_url
      if (!res.success || !portalUrl) {
        portalWindow?.close()
        toast.error(res.message || t('Unable to open subscription management'))
        return
      }

      if (portalWindow) {
        portalWindow.location.href = portalUrl
      } else {
        window.location.assign(portalUrl)
      }
    } catch {
      portalWindow?.close()
      toast.error(t('Unable to open subscription management'))
    } finally {
      setManagingSubscriptionId(null)
    }
  }

  const hasAny = allSubscriptions.length > 0

  useEffect(() => {
    if (loading) return
    onAvailabilityChange?.(hasAny)
  }, [loading, hasAny, onAvailabilityChange])

  const getRemainingDays = (sub: UserSubscriptionRecord) => {
    const endTime = sub?.subscription?.end_time || 0
    if (!endTime) return 0
    return Math.max(0, Math.ceil((endTime - currentTimestamp) / 86400))
  }

  const getUsagePercent = (sub: UserSubscriptionRecord) => {
    const total = Number(sub?.subscription?.amount_total || 0)
    const used = Number(sub?.subscription?.amount_used || 0)
    if (total <= 0) return 0
    return Math.round((used / total) * 100)
  }

  const sortedSubscriptions = useMemo(
    () =>
      [...allSubscriptions].sort(
        (a, b) =>
          (b.subscription?.end_time || 0) - (a.subscription?.end_time || 0)
      ),
    [allSubscriptions]
  )

  // Default view: only subscriptions that ended within the last 90 days, plus
  // anything still active (never hide a live subscription).
  const recentSubscriptions = useMemo(() => {
    const cutoff = currentTimestamp - RECENT_WINDOW_DAYS * SECONDS_PER_DAY
    return sortedSubscriptions.filter((sub) => {
      const endTime = sub.subscription?.end_time || 0
      // end_time unset => unknown date, never hide it
      if (!endTime) return true
      const isActive =
        sub.subscription?.status === 'active' && endTime >= currentTimestamp
      return isActive || endTime >= cutoff
    })
  }, [sortedSubscriptions, currentTimestamp])

  const hiddenCount = sortedSubscriptions.length - recentSubscriptions.length
  const visibleSubscriptions = showAll
    ? sortedSubscriptions
    : recentSubscriptions

  if (loading) {
    return (
      <Card
        data-card-hover='false'
        className='h-full gap-0 overflow-hidden py-0'
      >
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-40' />
        </CardHeader>
        <CardContent className='space-y-3 p-3 sm:p-5'>
          <Skeleton className='h-20 w-full' />
        </CardContent>
      </Card>
    )
  }

  if (!hasAny) {
    return null
  }

  return (
    <TitledCard
      title={t('My Subscriptions')}
      description={t('Manage your active and past subscriptions')}
      icon={<ListChecks className='h-4 w-4' />}
      disableHoverEffect
      className='flex h-full flex-col'
      contentClassName='flex min-h-0 flex-1 flex-col gap-3'
      action={
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')}
            />
          </Button>
          <Button
            variant='outline'
            size='sm'
            render={<Link to='/subscription-plans' />}
          >
            {t('Purchase Subscription')}
            <ArrowRight className='h-4 w-4' />
          </Button>
        </div>
      }
    >
      <div className='relative min-h-0 flex-1'>
        <div className='absolute inset-0 space-y-3 overflow-y-auto pr-1'>
          {visibleSubscriptions.map((sub) => {
            const subscription = sub.subscription
            const providerSubscription = sub.provider_subscription
            const totalAmount = Number(subscription?.amount_total || 0)
            const usedAmount = Number(subscription?.amount_used || 0)
            const remainAmount =
              totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
            const planTitle = planTitleMap.get(subscription?.plan_id) || ''
            const hasReset =
              planHasResetMap.get(subscription?.plan_id) ??
              (subscription?.next_reset_time ?? 0) > 0
            const estimatedTotal = planEstTotalMap.get(subscription?.plan_id)
            const remainDays = getRemainingDays(sub)
            const usagePercent = getUsagePercent(sub)
            const isExpired = (subscription?.end_time || 0) < currentTimestamp
            const isCancelled = subscription?.status === 'cancelled'
            const isActive = subscription?.status === 'active' && !isExpired
            const isStripeRecurring =
              providerSubscription?.provider === 'stripe'
            const isAutoRenewing =
              isStripeRecurring &&
              !providerSubscription.cancel_at_period_end &&
              ['active', 'trialing'].includes(providerSubscription.status)
            const providerPeriodEnd =
              providerSubscription?.current_period_end ||
              subscription?.end_time ||
              0
            const canManageStripe =
              isStripeRecurring && providerSubscription.management_available
            const isManaging = managingSubscriptionId === subscription?.id

            return (
              <div
                key={subscription?.id}
                className='bg-background rounded-md border p-3 text-xs'
              >
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>
                      {planTitle
                        ? `${planTitle} · ${t('Subscription')} #${subscription?.id}`
                        : `${t('Subscription')} #${subscription?.id}`}
                    </span>
                    {isActive ? (
                      <StatusBadge
                        label={t('Active')}
                        variant='success'
                        copyable={false}
                      />
                    ) : isCancelled ? (
                      <StatusBadge
                        label={t('Cancelled')}
                        variant='neutral'
                        copyable={false}
                      />
                    ) : (
                      <StatusBadge
                        label={t('Expired')}
                        variant='neutral'
                        copyable={false}
                      />
                    )}
                  </div>
                  {isActive && (
                    <span className='text-muted-foreground'>
                      {t('{{count}} days remaining', { count: remainDays })}
                    </span>
                  )}
                </div>
                <div className='text-muted-foreground mt-1.5'>
                  {isActive
                    ? t('Until')
                    : isCancelled
                      ? t('Cancelled at')
                      : t('Expired at')}{' '}
                  {new Date(
                    (subscription?.end_time || 0) * 1000
                  ).toLocaleString()}
                </div>
                {isStripeRecurring && (
                  <div className='mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2'>
                    <div className='min-w-0 space-y-0.5'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <StatusBadge
                          label={
                            providerSubscription.cancel_at_period_end
                              ? t('Cancellation scheduled')
                              : isAutoRenewing
                                ? t('Auto-renewing')
                                : t('Automatic renewal inactive')
                          }
                          variant={isAutoRenewing ? 'info' : 'neutral'}
                          copyable={false}
                        />
                        <span className='text-muted-foreground'>
                          Stripe · {providerSubscription.status}
                        </span>
                      </div>
                      {providerPeriodEnd > 0 && (
                        <p className='text-muted-foreground'>
                          {providerSubscription.cancel_at_period_end
                            ? t('Access ends on {{date}}', {
                                date: new Date(
                                  providerPeriodEnd * 1000
                                ).toLocaleString(),
                              })
                            : isAutoRenewing
                              ? t('Next charge on {{date}}', {
                                  date: new Date(
                                    providerPeriodEnd * 1000
                                  ).toLocaleString(),
                                })
                              : t('Current period ends on {{date}}', {
                                  date: new Date(
                                    providerPeriodEnd * 1000
                                  ).toLocaleString(),
                                })}
                        </p>
                      )}
                    </div>
                    {canManageStripe && (
                      <Button
                        variant='outline'
                        size='sm'
                        className='h-7 shrink-0 px-2 text-xs'
                        disabled={managingSubscriptionId !== null}
                        onClick={() =>
                          handleManageStripeSubscription(subscription.id)
                        }
                      >
                        {isManaging ? (
                          <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                        ) : (
                          <ExternalLink className='mr-1 h-3 w-3' />
                        )}
                        {t('Manage Stripe subscription')}
                      </Button>
                    )}
                  </div>
                )}
                {isActive && (subscription?.next_reset_time ?? 0) > 0 && (
                  <div className='text-muted-foreground mt-1'>
                    {t('Next reset')}:{' '}
                    {new Date(
                      subscription!.next_reset_time! * 1000
                    ).toLocaleString()}
                  </div>
                )}
                <div className='text-muted-foreground mt-1'>
                  {hasReset ? t('Period Quota') : t('Total Quota')}:{' '}
                  {totalAmount > 0 ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className='cursor-help' />}>
                        {formatQuota(usedAmount)}/{formatQuota(totalAmount)} ·{' '}
                        {t('Remaining')} {formatQuota(remainAmount)}
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('Raw Quota')}: {usedAmount}/{totalAmount} ·{' '}
                        {t('Remaining')} {remainAmount}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    t('Unlimited')
                  )}
                  {totalAmount > 0 && (
                    <span className='ml-2'>
                      {t('Used')} {usagePercent}%
                    </span>
                  )}
                </div>
                {hasReset && estimatedTotal && (
                  <div className='text-muted-foreground mt-1'>
                    {t('Total Quota')}: ≈ {formatQuota(estimatedTotal)}
                  </div>
                )}
                {totalAmount > 0 && isActive && (
                  <Progress value={usagePercent} className='mt-2 h-1.5' />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {hiddenCount > 0 && (
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground w-full shrink-0 text-xs'
          onClick={() => setShowAll((prev) => !prev)}
        >
          {showAll
            ? t('Show recent subscriptions only')
            : t('Show all subscriptions ({{n}} older)', {
                n: hiddenCount,
              })}
        </Button>
      )}
    </TitledCard>
  )
}
