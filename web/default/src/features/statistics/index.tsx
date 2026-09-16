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
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from '@/hooks'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionPageLayout } from '@/components/layout'
import { RevenueTab } from './components/revenue-tab'
import { UserUsageTab } from './components/user-usage-tab'
import {
  STATISTICS_DEFAULT_TAB,
  isStatisticsTabId,
  type StatisticsTabId,
} from './constants'

/**
 * Admin statistics page. The two tabs are page-local state rather than routed
 * segments — they share nothing, so there is no need for an extra route file.
 */
export function Statistics() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<StatisticsTabId>(STATISTICS_DEFAULT_TAB)
  const isMobile = useMediaQuery('(max-width: 640px)')

  return (
    <SectionPageLayout fixedContent={tab === 'usage' && !isMobile}>
      <SectionPageLayout.Title>{t('Statistics')}</SectionPageLayout.Title>

      <SectionPageLayout.Actions>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isStatisticsTabId(value)) setTab(value)
          }}
        >
          <TabsList>
            <TabsTrigger value='usage'>{t('User Usage')}</TabsTrigger>
            <TabsTrigger value='revenue'>{t('Revenue')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </SectionPageLayout.Actions>

      <SectionPageLayout.Content>
        {tab === 'usage' ? <UserUsageTab /> : <RevenueTab />}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
