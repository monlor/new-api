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
import DOMPurify from 'dompurify'

const FORBIDDEN_URI_SCHEME = /^(?:javascript|vbscript|data):/i

if (typeof window !== 'undefined') {
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName.toLowerCase().startsWith('on')) {
      data.keepAttr = false
      return
    }
    if (
      (data.attrName === 'href' ||
        data.attrName === 'src' ||
        data.attrName === 'xlink:href') &&
      FORBIDDEN_URI_SCHEME.test(String(data.attrValue).trim())
    ) {
      data.keepAttr = false
      node.removeAttribute(data.attrName)
    }
  })
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  if (typeof window === 'undefined') return ''

  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'form',
    ],
    FORBID_ATTR: ['srcdoc'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  })
}
