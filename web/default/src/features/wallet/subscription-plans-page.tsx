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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSelf } from '@/lib/api'
import { SectionPageLayout } from '@/components/layout'
import { SubscriptionPlansCard } from './components/subscription-plans-card'
import { useTopupInfo } from './hooks'
import type { UserWalletData } from './types'

export function SubscriptionPlansPage() {
  const { t } = useTranslation()
  const { topupInfo } = useTopupInfo()
  const [user, setUser] = useState<UserWalletData | null>(null)

  const fetchUser = useCallback(async () => {
    try {
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Purchase Subscription')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl'>
          <div className='mb-6 text-center sm:mb-8'>
            <h3 className='text-xl font-bold tracking-tight sm:text-2xl'>
              {t('Choose the plan that fits you')}
            </h3>
            <p className='text-muted-foreground mx-auto mt-2 max-w-xl text-sm'>
              {t(
                'All plans share the same API and can be stacked together at any time.'
              )}
            </p>
          </div>
          <SubscriptionPlansCard
            topupInfo={topupInfo}
            userQuota={user?.quota}
            onPurchaseSuccess={fetchUser}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
