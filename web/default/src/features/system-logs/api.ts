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
import { api } from '@/lib/api'
import type { GetSystemLogsParams, GetSystemLogsResponse } from './types'

export async function getSystemLogs(
  params: GetSystemLogsParams = {}
): Promise<GetSystemLogsResponse> {
  const queryParams = new URLSearchParams()
  const merged: Record<string, unknown> = {
    p: params.p || 1,
    page_size: params.page_size || 20,
    ...params,
  }
  Object.entries(merged).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      queryParams.append(key, String(value))
    }
  })
  const res = await api.get(`/api/log/system?${queryParams}`)
  return res.data
}
