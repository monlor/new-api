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
import type { StatusBadgeProps } from '@/components/status-badge'
import type { SystemLog } from './types'

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_SYSTEM_LOGS_DATA = {
  items: [] as SystemLog[],
  total: 0,
}

// ============================================================================
// System Log Type Enum
// ============================================================================

/**
 * Must match backend constants in model/system_log.go.
 * Independent namespace from model/log.go LogType* constants.
 */
export const SYSTEM_LOG_TYPE_ENUM = {
  TOPUP: 1,
  MANAGE: 2,
  SYSTEM: 3,
  REFUND: 4,
  LOGIN: 5,
  RATE_LIMIT: 6,
  TOKEN_REJECT: 7,
  MODEL_REJECT: 8,
} as const

export const SYSTEM_LOG_TYPE_ALL_VALUE = '0' as const

// labelKey values are i18n keys; use t(config.labelKey) in components
export const SYSTEM_LOG_TYPES: Record<
  number,
  { labelKey: string; variant: StatusBadgeProps['variant'] }
> = {
  [SYSTEM_LOG_TYPE_ENUM.TOPUP]: { labelKey: 'Top-up', variant: 'cyan' },
  [SYSTEM_LOG_TYPE_ENUM.MANAGE]: { labelKey: 'Manage', variant: 'orange' },
  [SYSTEM_LOG_TYPE_ENUM.SYSTEM]: { labelKey: 'System', variant: 'purple' },
  [SYSTEM_LOG_TYPE_ENUM.REFUND]: { labelKey: 'Refund', variant: 'blue' },
  [SYSTEM_LOG_TYPE_ENUM.LOGIN]: { labelKey: 'Login', variant: 'teal' },
  [SYSTEM_LOG_TYPE_ENUM.RATE_LIMIT]: {
    labelKey: 'Rate Limit Rejected',
    variant: 'warning',
  },
  [SYSTEM_LOG_TYPE_ENUM.TOKEN_REJECT]: {
    labelKey: 'Auth Rejected',
    variant: 'danger',
  },
  [SYSTEM_LOG_TYPE_ENUM.MODEL_REJECT]: {
    labelKey: 'Model Routing Rejected',
    variant: 'danger',
  },
} as const

/**
 * System log types for filter select (single select mode).
 * Backend treats type=0 as "all logs".
 */
export const SYSTEM_LOG_TYPE_FILTERS = [
  { label: 'All Types', value: SYSTEM_LOG_TYPE_ALL_VALUE },
  ...Object.entries(SYSTEM_LOG_TYPES).map(([value, config]) => ({
    label: config.labelKey,
    value,
  })),
] as const
