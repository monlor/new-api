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
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  sortPaymentMethods,
  type PaymentMethodItemModel,
} from '../lib/payment-methods'

export interface PaymentMethodSelectorItem extends PaymentMethodItemModel {
  icon?: ReactNode
  loading?: boolean
  onSelect: () => void
}

interface PaymentMethodSelectorProps {
  items: readonly PaymentMethodSelectorItem[]
  className?: string
}

export function PaymentMethodSelector({
  items,
  className,
}: PaymentMethodSelectorProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-3',
        className
      )}
    >
      {sortPaymentMethods(items).map((item) => {
        const button = (
          <Button
            key={item.id}
            variant='outline'
            onClick={item.onSelect}
            disabled={item.disabled || item.loading}
            className='h-9 w-full min-w-0 justify-start gap-2 rounded-lg px-3'
          >
            {item.loading ? (
              <Loader2 data-icon='inline-start' className='animate-spin' />
            ) : (
              item.icon
            )}
            <span className='truncate'>{item.label}</span>
          </Button>
        )

        return item.disabled && item.disabledReason ? (
          <TooltipProvider key={item.id}>
            <Tooltip>
              <TooltipTrigger
                className='inline-flex cursor-not-allowed'
                render={<span tabIndex={0} />}
              >
                {button}
              </TooltipTrigger>
              <TooltipContent>{item.disabledReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          button
        )
      })}
    </div>
  )
}
