import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  resolveAnnouncementContent,
  resolveNoticeContent,
} from './announcement-localization'

describe('resolveNoticeContent', () => {
  test('parses JSON returned by the Notice endpoint and selects an exact locale', () => {
    assert.equal(
      resolveNoticeContent(
        '{"en":"English","zh":"中文","zh-TW":"繁體中文"}',
        'zh-TW'
      ),
      '繁體中文'
    )
  })

  test('falls back only to English when no exact locale is configured', () => {
    assert.equal(
      resolveNoticeContent('{"en":"English","zh":"中文"}', 'zh-TW'),
      'English'
    )
  })

  test('preserves legacy plain-string notices as English', () => {
    assert.equal(resolveNoticeContent('Legacy notice', 'ja'), 'Legacy notice')
  })

  test('keeps the English extra when a content translation has no extra', () => {
    const resolved = resolveAnnouncementContent(
      {
        content: 'English announcement',
        extra: 'English extra',
        translations: { zh: { content: '中文公告' } },
      },
      'zh'
    )

    assert.equal(resolved.content, '中文公告')
    assert.equal(resolved.extra, 'English extra')
  })
})
