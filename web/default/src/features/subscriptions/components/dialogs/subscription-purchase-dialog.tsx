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
import { useState } from 'react'
import { Crown, CalendarClock, Package, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DEFAULT_CURRENCY_CONFIG } from '@/stores/system-config-store'
import { formatCurrencyFromUSD, formatQuotaWithCurrency } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { useSystemConfig } from '@/hooks/use-system-config'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Dialog } from '@/components/dialog'
import { GroupBadge } from '@/components/group-badge'
import {
  PaymentMethodSelector,
  type PaymentMethodSelectorItem,
} from '@/features/wallet/components/payment-method-selector'
import { getPaymentIcon } from '@/features/wallet/lib'
import { classifyPaymentMethod } from '@/features/wallet/lib/payment-methods'
import {
  paySubscriptionStripe,
  paySubscriptionCreem,
  paySubscriptionEpay,
  paySubscriptionWaffoPancake,
  paySubscriptionBalance,
} from '../../api'
import {
  formatDuration,
  formatResetPeriod,
  planHasReset,
  calcEstimatedTotal,
} from '../../lib'
import type { PlanRecord } from '../../types'

interface PaymentMethod {
  type: string
  name?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanRecord | null
  enableStripe?: boolean
  enableCreem?: boolean
  enableWaffoPancake?: boolean
  enableOnlineTopUp?: boolean
  epayMethods?: PaymentMethod[]
  purchaseLimit?: number
  purchaseCount?: number
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
}

export function SubscriptionPurchaseDialog(props: Props) {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const [paying, setPaying] = useState(false)

  const plan = props.plan?.plan
  if (!plan) return null

  const hasStripe = props.enableStripe && !!plan.stripe_price_id
  const hasCreem = props.enableCreem && !!plan.creem_product_id
  const hasWaffoPancake =
    props.enableWaffoPancake && !!plan.waffo_pancake_product_id
  const hasEpay =
    props.enableOnlineTopUp && (props.epayMethods || []).length > 0
  const totalAmount = Number(plan.total_amount || 0)
  const price = Number(plan.price_amount || 0).toFixed(2)
  const quotaPerUnit =
    currency?.quotaPerUnit && currency.quotaPerUnit > 0
      ? currency.quotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  const balanceCost = Math.max(
    0,
    Math.ceil(Number(plan.price_amount || 0) * quotaPerUnit)
  )
  const userQuota = Math.max(0, Number(props.userQuota || 0))
  const allowBalancePay = plan.allow_balance_pay !== false
  const insufficientBalance = userQuota < balanceCost
  const limitReached =
    (props.purchaseLimit || 0) > 0 &&
    (props.purchaseCount || 0) >= (props.purchaseLimit || 0)

  const handlePayStripe = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionStripe({ plan_id: plan.id })
      if (res.message === 'success' && res.data?.pay_link) {
        window.open(res.data.pay_link, '_blank')
        toast.success(t('Payment page opened'))
        props.onOpenChange(false)
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const handlePayCreem = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionCreem({ plan_id: plan.id })
      if (res.message === 'success' && res.data?.checkout_url) {
        window.open(res.data.checkout_url, '_blank')
        toast.success(t('Payment page opened'))
        props.onOpenChange(false)
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  // In-tab redirect (not window.open) — user-gesture context is lost
  // across the await, so a popup would be blocked. Same as the wallet hook.
  const handlePayWaffoPancake = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionWaffoPancake({ plan_id: plan.id })
      if (res.message === 'success' && res.data?.checkout_url) {
        toast.success(t('Redirecting to payment page...'))
        window.location.href = res.data.checkout_url
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const isSafari =
    typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  const handlePayEpay = async (paymentMethod: string) => {
    if (!paymentMethod) {
      toast.error(t('Please select a payment method'))
      return
    }
    setPaying(true)
    try {
      const res = await paySubscriptionEpay({
        plan_id: plan.id,
        payment_method: paymentMethod,
      })
      if (res.message === 'success' && res.url) {
        const form = document.createElement('form')
        form.action = res.url
        form.method = 'POST'
        if (!isSafari) {
          form.target = '_blank'
        }
        Object.entries(res.data || {}).forEach(([key, value]) => {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = key
          input.value = String(value)
          form.appendChild(input)
        })
        document.body.appendChild(form)
        form.submit()
        document.body.removeChild(form)
        toast.success(t('Payment initiated'))
        props.onOpenChange(false)
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const handlePayBalance = async () => {
    if (!allowBalancePay) {
      toast.error(t('This plan does not allow balance redemption'))
      return
    }
    setPaying(true)
    try {
      const res = await paySubscriptionBalance({ plan_id: plan.id })
      if (res.success) {
        toast.success(t('Subscription purchased successfully'))
        void props.onPurchaseSuccess?.()
        props.onOpenChange(false)
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const paymentMethodItems: PaymentMethodSelectorItem[] = [
    {
      id: 'balance',
      label: t('Balance'),
      category: 'balance',
      icon: <WalletCards className='h-4 w-4' />,
      disabled:
        paying || limitReached || !allowBalancePay || insufficientBalance,
      disabledReason: !allowBalancePay
        ? t('This plan does not allow balance redemption')
        : insufficientBalance
          ? t('Insufficient balance')
          : undefined,
      onSelect: handlePayBalance,
    },
    ...(hasStripe
      ? [
          {
            id: 'stripe',
            label: t('Credit Card (Stripe)'),
            category: 'card' as const,
            icon: getPaymentIcon('stripe'),
            disabled: paying || limitReached,
            onSelect: handlePayStripe,
          },
        ]
      : []),
    ...(hasCreem
      ? [
          {
            id: 'creem',
            label: 'Creem',
            category: 'normal' as const,
            icon: getPaymentIcon('creem'),
            disabled: paying || limitReached,
            onSelect: handlePayCreem,
          },
        ]
      : []),
    ...(hasWaffoPancake
      ? [
          {
            id: 'waffo-pancake',
            label: 'Waffo Pancake',
            category: 'crypto' as const,
            icon: getPaymentIcon('waffo_pancake'),
            disabled: paying || limitReached,
            onSelect: handlePayWaffoPancake,
          },
        ]
      : []),
    ...(hasEpay
      ? (props.epayMethods || []).map((method, index) => ({
          id: `epay-${method.type}-${index}`,
          label: method.name || method.type,
          category: classifyPaymentMethod({
            type: method.type,
            name: method.name,
            provider: 'epay',
          }),
          icon: getPaymentIcon(method.type),
          disabled: paying || limitReached,
          onSelect: () => handlePayEpay(method.type),
        }))
      : []),
  ]

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <Crown className='h-5 w-5' />
          {t('Purchase Subscription')}
        </>
      }
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-2xl'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='space-y-3 sm:space-y-4'>
        <div className='bg-muted/50 space-y-2.5 rounded-lg border p-3 sm:space-y-3 sm:p-4'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('Plan Name')}
            </span>
            <span className='max-w-[200px] truncate text-sm font-medium'>
              {plan.title}
            </span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('Validity Period')}
            </span>
            <span className='flex items-center gap-1 text-sm'>
              <CalendarClock className='h-3.5 w-3.5' />
              {formatDuration(plan, t)}
            </span>
          </div>
          {formatResetPeriod(plan, t) !== t('No Reset') && (
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Reset Period')}
              </span>
              <span className='text-sm'>{formatResetPeriod(plan, t)}</span>
            </div>
          )}
          {planHasReset(plan) ? (
            <>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Period Quota')}
                </span>
                <span className='flex items-center gap-1 text-sm'>
                  <Package className='h-3.5 w-3.5' />
                  {totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')}
                </span>
              </div>
              {totalAmount > 0 && (
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-sm'>
                    {t('Total Quota')}
                  </span>
                  <span className='text-sm'>
                    {(() => {
                      const est = calcEstimatedTotal(plan)
                      return est ? `≈ ${formatQuota(est)}` : t('Unlimited')
                    })()}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Total Quota')}
              </span>
              <span className='flex items-center gap-1 text-sm'>
                <Package className='h-3.5 w-3.5' />
                {totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')}
              </span>
            </div>
          )}
          {plan.upgrade_group && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Upgrade Group')}
              </span>
              <GroupBadge group={plan.upgrade_group} />
            </div>
          )}
          <Separator />
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>{t('Amount Due')}</span>
            <span className='text-primary text-lg font-bold'>
              {formatCurrencyFromUSD(Number(price))}
            </span>
          </div>
        </div>

        {limitReached && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Purchase limit reached')} ({props.purchaseCount}/
              {props.purchaseLimit})
            </AlertDescription>
          </Alert>
        )}

        <div className='flex flex-col gap-2 rounded-md border p-3'>
          <div className='flex items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground'>{t('Required')}</span>
            <span>{formatCurrencyFromUSD(Number(plan.price_amount || 0))}</span>
          </div>
          <div className='flex items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground'>{t('Available')}</span>
            <span>{formatQuotaWithCurrency(userQuota)}</span>
          </div>
          {!allowBalancePay ? (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('This plan does not allow balance redemption')}
              </AlertDescription>
            </Alert>
          ) : (
            insufficientBalance && (
              <Alert variant='destructive'>
                <AlertDescription>{t('Insufficient balance')}</AlertDescription>
              </Alert>
            )
          )}
        </div>

        <div className='space-y-3'>
          <p className='text-muted-foreground text-xs'>
            {t('Select payment method')}
          </p>
          <PaymentMethodSelector items={paymentMethodItems} />
        </div>
      </div>
    </Dialog>
  )
}
