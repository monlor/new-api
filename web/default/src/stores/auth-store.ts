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
import { create } from 'zustand'

export type UserPermissions = {
  sidebar_settings?: boolean
  sidebar_modules?: Record<string, unknown>
}

export interface AuthUser {
  id: number
  username: string
  display_name?: string
  email?: string
  role: number
  status?: number
  group?: string
  quota?: number
  used_quota?: number
  request_count?: number
  aff_code?: string
  aff_count?: number
  aff_quota?: number
  aff_history_quota?: number
  inviter_id?: number
  github_id?: string
  oidc_id?: string
  wechat_id?: string
  telegram_id?: string
  linux_do_id?: string
  setting?: Record<string, unknown> | string
  stripe_customer?: string
  sidebar_modules?: string
  permissions?: UserPermissions
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    reset: () => void
  }
}

const SECRET_SETTING_KEYS = ['webhook_secret', 'gotify_token'] as const

function stripSecretsFromSetting(
  setting: AuthUser['setting']
): AuthUser['setting'] {
  if (setting == null) return setting

  const stripRecord = (record: Record<string, unknown>) => {
    const next = { ...record }
    for (const key of SECRET_SETTING_KEYS) {
      delete next[key]
    }
    return next
  }

  if (typeof setting === 'string') {
    try {
      const parsed = JSON.parse(setting) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(stripRecord(parsed as Record<string, unknown>))
      }
    } catch {
      return setting
    }
    return setting
  }

  if (typeof setting === 'object' && !Array.isArray(setting)) {
    return stripRecord({ ...setting })
  }

  return setting
}

function stripUserSecretsForPersist(user: AuthUser): AuthUser {
  return {
    ...user,
    setting: stripSecretsFromSetting(user.setting),
  }
}

function persistUser(user: AuthUser | null) {
  if (typeof window === 'undefined') return
  if (!user) {
    window.localStorage.removeItem('user')
    return
  }
  window.localStorage.setItem(
    'user',
    JSON.stringify(stripUserSecretsForPersist(user))
  )
}

export const useAuthStore = create<AuthState>()((set) => {
  // Restore user info from localStorage
  const initUser = (() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem('user')
        if (!saved) return null
        const parsed = JSON.parse(saved) as AuthUser
        const sanitized = stripUserSecretsForPersist(parsed)
        window.localStorage.setItem('user', JSON.stringify(sanitized))
        return sanitized
      }
    } catch {
      // Clear dirty data when parsing fails
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('user')
      }
    }
    return null
  })()

  return {
    auth: {
      user: initUser,
      setUser: (user) =>
        set((state) => {
          persistUser(user)
          return { ...state, auth: { ...state.auth, user } }
        }),
      reset: () =>
        set((state) => {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('user')
          }
          return {
            ...state,
            auth: { ...state.auth, user: null },
          }
        }),
    },
  }
})
