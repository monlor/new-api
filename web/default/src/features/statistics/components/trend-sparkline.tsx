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
import { cn } from '@/lib/utils'

/**
 * Tiny inline SVG sparkline for table cells. Deliberately dependency-free —
 * mounting a Recharts container per row would be far heavier than this.
 * Renders nothing when there is no series (e.g. backend has not shipped
 * per-user trend data yet).
 */
export function TrendSparkline(props: {
  values?: number[]
  className?: string
}) {
  const values = props.values ?? []

  if (values.length < 2) {
    return (
      <span className='text-muted-foreground/60 text-xs' aria-hidden='true'>
        —
      </span>
    )
  }

  const sanitized = values.map((value) => Math.max(0, Number(value) || 0))
  const width = 72
  const height = 20
  const padding = 2
  const max = Math.max(...sanitized)
  const min = Math.min(...sanitized)
  const range = max - min

  const points = sanitized.map((value, index) => {
    const x = (index / (sanitized.length - 1)) * width
    const normalized = range > 0 ? (value - min) / range : 0.5
    const y = height - padding - normalized * (height - padding * 2)
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio='none'
      className={cn('text-primary h-5 w-18', props.className)}
      aria-hidden='true'
    >
      <path
        d={points.join(' ')}
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
        vectorEffect='non-scaling-stroke'
      />
    </svg>
  )
}
