import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import en from './locales/en.json'

const STORAGE_KEY = 'lang'
const SUPPORTED_LANGUAGES = ['zh-CN', 'zh-TW', 'en'] as const
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]
const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN'

const detectLanguage = (): SupportedLanguage => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)) {
    return stored as SupportedLanguage
  }

  const browserLang = navigator.language
  if (SUPPORTED_LANGUAGES.includes(browserLang as SupportedLanguage)) {
    return browserLang as SupportedLanguage
  }

  if (browserLang.startsWith('zh-TW') || browserLang.startsWith('zh-Hant')) {
    return 'zh-TW'
  }
  if (browserLang.startsWith('zh')) {
    return 'zh-CN'
  }
  if (browserLang.startsWith('en')) {
    return 'en'
  }

  return DEFAULT_LANGUAGE
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    'en': { translation: en },
  },
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

export const changeLanguage = (lang: SupportedLanguage) => {
  localStorage.setItem(STORAGE_KEY, lang)
  i18n.changeLanguage(lang)
}

export const getCurrentLanguage = (): string => {
  return i18n.language || DEFAULT_LANGUAGE
}

export const getLocaleString = (): string => {
  const lang = getCurrentLanguage()
  if (lang === 'zh-TW') return 'zh-TW'
  if (lang === 'en') return 'en-US'
  return 'zh-CN'
}

export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE }
export type { SupportedLanguage }
export default i18n
