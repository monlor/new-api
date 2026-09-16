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
import { z } from 'zod'

// ============================================================================
// Subscription Plan Schema & Types
// ============================================================================

export const subscriptionPlanSchema = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().optional(),
  price_amount: z.number(),
  currency: z.string().default('USD'),
  duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
  duration_value: z.number(),
  custom_seconds: z.number().optional(),
  quota_reset_period: z.enum(['never', 'daily', 'weekly', 'monthly', 'custom']),
  quota_reset_custom_seconds: z.number().optional(),
  enabled: z.boolean(),
  sort_order: z.number(),
  allow_balance_pay: z.boolean().optional().default(true),
  max_purchase_per_user: z.number(),
  total_amount: z.number(),
  upgrade_group: z.string().optional(),
  stripe_price_id: z.string().optional(),
  creem_product_id: z.string().optional(),
  waffo_pancake_product_id: z.string().optional(),
  is_recommended: z.boolean().optional(),
  /** Comma-separated model IDs shown as "hot models" on the purchase card. */
  display_models: z.string().optional(),
  /**
   * Comma-separated model IDs this plan may pay for (empty = no restriction).
   * Snapshotted onto each UserSubscription at creation.
   */
  allowed_models: z.string().optional(),
})

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>

export interface PlanRecord {
  plan: SubscriptionPlan
}

// ============================================================================
// User Subscription Schema & Types
// ============================================================================

export const userSubscriptionSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  plan_id: z.number(),
  status: z.string(),
  source: z.string().optional(),
  start_time: z.number(),
  end_time: z.number(),
  amount_total: z.number(),
  amount_used: z.number(),
  next_reset_time: z.number().optional(),
  /**
   * Comma-separated model IDs this subscription may pay for (empty = no
   * restriction). Snapshotted from the plan, editable per subscription.
   */
  allowed_models: z.string().optional(),
  /**
   * Admin-chosen display name. Only meaningful when plan_id <= 0 (custom
   * assignment); empty string falls back to t('Custom assignment').
   */
  custom_name: z.string().optional(),
})

export type UserSubscription = z.infer<typeof userSubscriptionSchema>

/**
 * Admin edit form for a single UserSubscription row.
 * `cancelled` is kept so an already-invalidated row can still display; the
 * edit UI does not offer it as a target.
 *
 * amount_total is edited as a display-currency amount (USD/CNY) and
 * converted to/from raw quota units via quotaUnitsToDollars/
 * parseQuotaFromDollars at the load/submit boundary (see
 * user-subscription-edit-form.tsx), mirroring the plan editor's
 * "Available amount" field.
 *
 * amount_used_percent replaces a raw amount_used input: admins adjust usage
 * as a 0-100 percentage of amount_total (2 decimal places), which is
 * converted back to raw quota units on submit. Meaningless when
 * amount_total is 0 (unlimited) — the form disables the field in that case
 * and leaves the subscription's existing amount_used untouched.
 */
export const userSubscriptionEditSchema = z
  .object({
    amount_used_percent: z.number().min(0).max(100),
    amount_total: z.number().min(0),
    end_time: z.number(),
    status: z.enum(['active', 'expired', 'cancelled']),
    allowed_models: z.string().optional(),
    custom_name: z.string().optional(),
  })
  .refine((data) => data.status !== 'active' || data.end_time > 0, {
    message: 'Active subscriptions require an end time',
    path: ['end_time'],
  })

export type UserSubscriptionEditForm = z.infer<
  typeof userSubscriptionEditSchema
>

export interface ProviderSubscription {
  provider: string
  status: string
  current_period_start: number
  current_period_end: number
  cancel_at_period_end: boolean
  management_available: boolean
}

export interface UserSubscriptionRecord {
  subscription: UserSubscription
  provider_subscription?: ProviderSubscription | null
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PlanPayload {
  plan: Partial<SubscriptionPlan>
}

export interface SubscriptionPayRequest {
  plan_id: number
  payment_method?: string
}

export interface SubscriptionPayResponse {
  success: boolean
  message?: string
  data?: {
    // Stripe-style hosted checkout link.
    pay_link?: string
    // Waffo Pancake / Creem hosted checkout URL.
    checkout_url?: string
    // Pancake-only: order metadata + self-service buyer session token,
    // surfaced for future flows (refund / cancel from new-api's own UI).
    session_id?: string
    expires_at?: number | string
    order_id?: string
    token?: string
    token_expires_at?: number | string
  }
  url?: string
}

export interface StripePortalResponse {
  portal_url: string
}

export interface CreateUserSubscriptionRequest {
  plan_id: number
  /** The fields below apply only when plan_id <= 0 (custom assignment). */
  duration_unit?: 'year' | 'month' | 'day' | 'hour' | 'custom'
  duration_value?: number
  custom_seconds?: number
  allowed_models?: string
  /** Display name for the custom assignment; empty = generic fallback label. */
  custom_name?: string
  /** Raw quota units (converted from the display-currency input on submit). */
  total_amount?: number
}

// ============================================================================
// Self Subscription Data (user-facing)
// ============================================================================

export interface SelfSubscriptionData {
  subscriptions: UserSubscriptionRecord[]
  all_subscriptions: UserSubscriptionRecord[]
}

// ============================================================================
// Batch Subscription Map (admin user list)
// ============================================================================

/** userId (string key from JSON) -> latest active UserSubscription */
export type UserSubscriptionBatchMap = Record<string, UserSubscription>

// ============================================================================
// Dialog Types
// ============================================================================

export type SubscriptionsDialogType =
  | 'create'
  | 'update'
  | 'toggle-status'
  | 'force-sync'
