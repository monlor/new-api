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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getCookie, removeCookie, setCookie } from '@/lib/cookies'
import { type SystemConfig, useSystemConfigStore } from '@/stores/system-config-store'
import {
  CONTENT_LAYOUT_VALUES,
  type ContentLayout,
  DEFAULT_THEME_CUSTOMIZATION,
  resolveThemeFont,
  THEME_COOKIE_KEYS,
  THEME_FONT_VALUES,
  THEME_PRESET_VALUES,
  THEME_RADIUS_VALUES,
  THEME_SCALE_VALUES,
  type ThemeCustomization,
  type ThemeFont,
  type ThemePreset,
  type ThemeRadius,
  type ThemeScale,
} from '@/lib/theme-customization'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function getSystemCustomizationDefaults(): ThemeCustomization {
  const cfg = useSystemConfigStore.getState().config
  return {
    preset: (cfg.defaultThemePreset as ThemePreset) || DEFAULT_THEME_CUSTOMIZATION.preset,
    font: (cfg.defaultThemeFont as ThemeFont) || DEFAULT_THEME_CUSTOMIZATION.font,
    radius: (cfg.defaultThemeRadius as ThemeRadius) || DEFAULT_THEME_CUSTOMIZATION.radius,
    scale: (cfg.defaultThemeScale as ThemeScale) || DEFAULT_THEME_CUSTOMIZATION.scale,
    contentLayout: (cfg.defaultThemeContentLayout as ContentLayout) || DEFAULT_THEME_CUSTOMIZATION.contentLayout,
  }
}

function readCookie<T extends string>(
  name: string,
  allowed: ReadonlySet<T>,
  fallback: T
): T {
  const value = getCookie(name)
  return value && allowed.has(value as T) ? (value as T) : fallback
}

function applyAttribute(name: string, value: string | null) {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body) return
  if (value === null) {
    body.removeAttribute(name)
  } else {
    body.setAttribute(name, value)
  }
}

type ThemeCustomizationContextType = {
  defaults: ThemeCustomization
  customization: ThemeCustomization
  setPreset: (preset: ThemePreset) => void
  setFont: (font: ThemeFont) => void
  setRadius: (radius: ThemeRadius) => void
  setScale: (scale: ThemeScale) => void
  setContentLayout: (contentLayout: ContentLayout) => void
  resetCustomization: () => void
}

// Fallback used when a consumer renders outside the provider (e.g. an error
// route mounted before providers are ready, or stale HMR boundaries). Keeping
// it permissive prevents the whole tree from crashing — the UI just behaves
// like the defaults until the real provider re-mounts.
const FALLBACK_CONTEXT: ThemeCustomizationContextType = {
  defaults: DEFAULT_THEME_CUSTOMIZATION,
  customization: DEFAULT_THEME_CUSTOMIZATION,
  setPreset: () => {},
  setFont: () => {},
  setRadius: () => {},
  setScale: () => {},
  setContentLayout: () => {},
  resetCustomization: () => {},
}

const ThemeCustomizationContext =
  createContext<ThemeCustomizationContextType>(FALLBACK_CONTEXT)

export function ThemeCustomizationProvider(props: {
  children: React.ReactNode
}) {
  const systemDefaults = getSystemCustomizationDefaults()

  const [preset, _setPreset] = useState<ThemePreset>(() =>
    readCookie<ThemePreset>(
      THEME_COOKIE_KEYS.preset,
      THEME_PRESET_VALUES,
      systemDefaults.preset
    )
  )
  const [font, _setFont] = useState<ThemeFont>(() =>
    readCookie<ThemeFont>(
      THEME_COOKIE_KEYS.font,
      THEME_FONT_VALUES,
      systemDefaults.font
    )
  )
  const [radius, _setRadius] = useState<ThemeRadius>(() =>
    readCookie<ThemeRadius>(
      THEME_COOKIE_KEYS.radius,
      THEME_RADIUS_VALUES,
      systemDefaults.radius
    )
  )
  const [scale, _setScale] = useState<ThemeScale>(() =>
    readCookie<ThemeScale>(
      THEME_COOKIE_KEYS.scale,
      THEME_SCALE_VALUES,
      systemDefaults.scale
    )
  )
  const [contentLayout, _setContentLayout] = useState<ContentLayout>(() =>
    readCookie<ContentLayout>(
      THEME_COOKIE_KEYS.contentLayout,
      CONTENT_LAYOUT_VALUES,
      systemDefaults.contentLayout
    )
  )

  // Apply server-configured defaults for dimensions the user hasn't overridden with a cookie.
  // Runs immediately at mount (catches config already loaded before mount) and re-runs
  // whenever the store updates (admin saves new defaults or API response arrives late).
  useEffect(() => {
    const applyConfig = (cfg: SystemConfig) => {
      if (!getCookie(THEME_COOKIE_KEYS.preset)) {
        const v = cfg.defaultThemePreset as ThemePreset
        if (v && THEME_PRESET_VALUES.has(v)) _setPreset(v)
      }
      if (!getCookie(THEME_COOKIE_KEYS.font)) {
        const v = cfg.defaultThemeFont as ThemeFont
        if (v && THEME_FONT_VALUES.has(v)) _setFont(v)
      }
      if (!getCookie(THEME_COOKIE_KEYS.radius)) {
        const v = cfg.defaultThemeRadius as ThemeRadius
        if (v && THEME_RADIUS_VALUES.has(v)) _setRadius(v)
      }
      if (!getCookie(THEME_COOKIE_KEYS.scale)) {
        const v = cfg.defaultThemeScale as ThemeScale
        if (v && THEME_SCALE_VALUES.has(v)) _setScale(v)
      }
      if (!getCookie(THEME_COOKIE_KEYS.contentLayout)) {
        const v = cfg.defaultThemeContentLayout as ContentLayout
        if (v && CONTENT_LAYOUT_VALUES.has(v)) _setContentLayout(v)
      }
    }
    // Run once with current state to close the gap between useState init and subscription.
    applyConfig(useSystemConfigStore.getState().config)
    return useSystemConfigStore.subscribe((state) => applyConfig(state.config))
  }, [])

  // Mirror state to the <body> via data-* attributes so theme-presets.css can
  // override CSS variables at the right cascade layer.
  useEffect(() => {
    applyAttribute(
      'data-theme-preset',
      preset === DEFAULT_THEME_CUSTOMIZATION.preset ? null : preset
    )
  }, [preset])

  // Font is the one axis where we resolve before writing the attribute:
  // the persisted preference may be `default`, but CSS works in terms of
  // the concrete `sans`/`serif` choice that should drive the cascade.
  // Resolving here (instead of in CSS via `:not()` selectors) keeps the
  // stylesheet to one simple `[data-theme-font='serif']` selector and lets
  // future presets opt into typography via `PRESET_DEFAULT_FONT` alone.
  useEffect(() => {
    applyAttribute('data-theme-font', resolveThemeFont(font, preset))
  }, [font, preset])

  useEffect(() => {
    applyAttribute(
      'data-theme-radius',
      radius === DEFAULT_THEME_CUSTOMIZATION.radius ? null : radius
    )
  }, [radius])

  useEffect(() => {
    applyAttribute(
      'data-theme-scale',
      scale === DEFAULT_THEME_CUSTOMIZATION.scale ? null : scale
    )
  }, [scale])

  useEffect(() => {
    applyAttribute('data-theme-content-layout', contentLayout)
  }, [contentLayout])

  const setPreset = useCallback((value: ThemePreset) => {
    _setPreset(value)
    if (value === DEFAULT_THEME_CUSTOMIZATION.preset) {
      removeCookie(THEME_COOKIE_KEYS.preset)
    } else {
      setCookie(THEME_COOKIE_KEYS.preset, value, COOKIE_MAX_AGE)
    }
  }, [])

  const setFont = useCallback((value: ThemeFont) => {
    _setFont(value)
    if (value === DEFAULT_THEME_CUSTOMIZATION.font) {
      removeCookie(THEME_COOKIE_KEYS.font)
    } else {
      setCookie(THEME_COOKIE_KEYS.font, value, COOKIE_MAX_AGE)
    }
  }, [])

  const setRadius = useCallback((value: ThemeRadius) => {
    _setRadius(value)
    if (value === DEFAULT_THEME_CUSTOMIZATION.radius) {
      removeCookie(THEME_COOKIE_KEYS.radius)
    } else {
      setCookie(THEME_COOKIE_KEYS.radius, value, COOKIE_MAX_AGE)
    }
  }, [])

  const setScale = useCallback((value: ThemeScale) => {
    _setScale(value)
    if (value === DEFAULT_THEME_CUSTOMIZATION.scale) {
      removeCookie(THEME_COOKIE_KEYS.scale)
    } else {
      setCookie(THEME_COOKIE_KEYS.scale, value, COOKIE_MAX_AGE)
    }
  }, [])

  const setContentLayout = useCallback((value: ContentLayout) => {
    _setContentLayout(value)
    if (value === DEFAULT_THEME_CUSTOMIZATION.contentLayout) {
      removeCookie(THEME_COOKIE_KEYS.contentLayout)
    } else {
      setCookie(THEME_COOKIE_KEYS.contentLayout, value, COOKIE_MAX_AGE)
    }
  }, [])

  const resetCustomization = useCallback(() => {
    const d = getSystemCustomizationDefaults()
    setPreset(d.preset)
    setFont(d.font)
    setRadius(d.radius)
    setScale(d.scale)
    setContentLayout(d.contentLayout)
  }, [setPreset, setFont, setRadius, setScale, setContentLayout])

  const value = useMemo<ThemeCustomizationContextType>(
    () => ({
      defaults: getSystemCustomizationDefaults(),
      customization: { preset, font, radius, scale, contentLayout },
      setPreset,
      setFont,
      setRadius,
      setScale,
      setContentLayout,
      resetCustomization,
    }),
    [
      preset,
      font,
      radius,
      scale,
      contentLayout,
      setPreset,
      setFont,
      setRadius,
      setScale,
      setContentLayout,
      resetCustomization,
    ]
  )

  return (
    <ThemeCustomizationContext.Provider value={value}>
      {props.children}
    </ThemeCustomizationContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useThemeCustomization() {
  return useContext(ThemeCustomizationContext)
}
