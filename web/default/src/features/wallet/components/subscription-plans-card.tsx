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
import { useTranslation } from 'react-i18next'
import { useSystemConfigStore } from '@/stores/system-config-store'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { getModelSeries } from '@/features/subscriptions/lib'
import { buildPlanCardModel } from '@/features/subscriptions/lib/plan-card-model'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import type { PaymentMethod, TopupInfo } from '../types'
import { PlanPurchaseCard } from './plan-purchase-card'

interface SubscriptionPlansCardProps {
  topupInfo: TopupInfo | null
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
}

function getEpayMethods(payMethods: PaymentMethod[] = []): PaymentMethod[] {
  return payMethods.filter(
    (m) => m?.type && m.type !== 'stripe' && m.type !== 'creem'
  )
}

export function SubscriptionPlansCard({
  topupInfo,
  userQuota,
  onPurchaseSuccess,
}: SubscriptionPlansCardProps) {
  const { t } = useTranslation()
  const { models: pricingModels } = usePricingData()
  const quotaPerUnit = useSystemConfigStore(
    (s) => s.config.currency.quotaPerUnit
  )

  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [loading, setLoading] = useState(true)

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)

  const enableStripe = !!topupInfo?.enable_stripe_topup
  const enableCreem = !!topupInfo?.enable_creem_topup
  const enableWaffoPancake = !!topupInfo?.enable_waffo_pancake_topup
  const enableOnlineTopUp = !!topupInfo?.enable_online_topup
  const epayMethods = useMemo(
    () => getEpayMethods(topupInfo?.pay_methods),
    [topupInfo?.pay_methods]
  )

  const fetchPlans = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (res.success) {
        setPlans(res.data || [])
      }
    } catch {
      setPlans([])
    }
  }, [])

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (res.success && res.data) {
        setAllSubscriptions(res.data.all_subscriptions || [])
      }
    } catch {
      // ignore — purchase-limit gating degrades gracefully to "not reached"
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchSelfSubscription()])
      setLoading(false)
    }
    init()
  }, [fetchPlans, fetchSelfSubscription])

  const purchaseCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  const modelsBySeries = useMemo(() => {
    const map = new Map<string, typeof pricingModels>()
    for (const model of pricingModels) {
      const series = getModelSeries(model.model_name)
      if (!series) continue
      const bucket = map.get(series)
      if (bucket) bucket.push(model)
      else map.set(series, [model])
    }
    return map
  }, [pricingModels])

  if (loading) {
    return (
      <div className='grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card
            key={i}
            data-card-hover='false'
            className='gap-0 overflow-hidden py-0'
          >
            <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
              <Skeleton className='h-6 w-32' />
            </CardHeader>
            <CardContent className='space-y-3 p-3 sm:p-5'>
              <Skeleton className='h-40 w-full' />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (plans.length === 0) {
    return null
  }

  return (
    <>
      <div
        className={cn(
          'mx-auto grid grid-cols-1 items-start gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3',
          plans.length === 1 && 'max-w-sm md:grid-cols-1 lg:grid-cols-1',
          plans.length === 2 && 'max-w-3xl lg:grid-cols-2'
        )}
      >
        {plans.map((p) => {
          const plan = p?.plan
          if (!plan) return null
          const card = buildPlanCardModel({
            plan,
            purchaseCount: purchaseCounts.get(plan.id) || 0,
            pricingModels,
            modelsBySeries,
            quotaPerUnit,
            t,
          })
          return (
            <PlanPurchaseCard
              key={plan.id}
              model={card}
              onSubscribe={() => {
                setSelectedPlan(p)
                setPurchaseOpen(true)
              }}
            />
          )
        })}
      </div>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            fetchSelfSubscription()
          }
        }}
        plan={selectedPlan}
        enableStripe={enableStripe}
        enableCreem={enableCreem}
        enableWaffoPancake={enableWaffoPancake}
        enableOnlineTopUp={enableOnlineTopUp}
        epayMethods={epayMethods}
        userQuota={userQuota}
        onPurchaseSuccess={onPurchaseSuccess}
        purchaseLimit={
          selectedPlan?.plan?.max_purchase_per_user
            ? Number(selectedPlan.plan.max_purchase_per_user)
            : undefined
        }
        purchaseCount={
          selectedPlan?.plan?.id
            ? purchaseCounts.get(selectedPlan.plan.id)
            : undefined
        }
      />
    </>
  )
}
