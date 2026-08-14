export const ANNOUNCEMENT_LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'zh-TW', label: 'Traditional Chinese' },
  { value: 'fr', label: 'French' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'vi', label: 'Vietnamese' },
] as const

export type AnnouncementLocale = (typeof ANNOUNCEMENT_LOCALES)[number]['value']

export type AnnouncementTranslation = {
  content: string
  extra?: string
}

export type AnnouncementTranslations = Partial<
  Record<AnnouncementLocale, AnnouncementTranslation>
>

type LocalizedAnnouncement = {
  content: string
  extra?: string
  translations?: AnnouncementTranslations
}

function getLocale(language: string): AnnouncementLocale {
  return language === 'en' || language.startsWith('en-')
    ? 'en'
    : (language as AnnouncementLocale)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Legacy notices are plain English strings. New notices are locale maps and
 * deliberately fall back to English only, never to a parent locale.
 */
export function resolveNoticeContent(value: unknown, language: string): string {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (isRecord(parsed)) return resolveNoticeContent(parsed, language)
    } catch {
      // Plain-string notices are legacy English notices.
    }
    return value.trim()
  }
  if (!isRecord(value)) return ''

  const locale = getLocale(language)
  const localized = value[locale]
  if (typeof localized === 'string' && localized.trim()) return localized.trim()

  const english = value.en
  return typeof english === 'string' ? english.trim() : ''
}

export function resolveAnnouncementContent<T extends LocalizedAnnouncement>(
  announcement: T,
  language: string
): T {
  const translation = announcement.translations?.[getLocale(language)]
  if (!translation?.content?.trim()) return announcement

  return {
    ...announcement,
    content: translation.content,
    // A translation only needs localized content. Keep the default English
    // extra when this locale does not provide one.
    extra: translation.extra ?? announcement.extra,
  }
}
