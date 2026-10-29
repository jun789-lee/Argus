import { afterEach, describe, expect, test } from 'vitest'
import { localizeDateGroup, t, tn, useLangStore } from './index'

describe('i18n', () => {
  afterEach(() => useLangStore.getState().setLang('en'))

  test('returns the English key when lang is en', () => {
    useLangStore.getState().setLang('en')
    expect(t('Settings')).toBe('Settings')
  })

  test('translates known keys to Korean', () => {
    useLangStore.getState().setLang('ko')
    expect(t('Settings')).toBe('설정')
  })

  test('falls back to English for missing keys', () => {
    useLangStore.getState().setLang('ko')
    expect(t('Some untranslated string')).toBe('Some untranslated string')
  })

  test('fills placeholders', () => {
    useLangStore.getState().setLang('en')
    expect(t('Back to {name}', { name: 'proj' })).toBe('Back to proj')
    useLangStore.getState().setLang('ko')
    expect(t('{n}m ago', { n: 5 })).toBe('5분 전')
  })

  test('tn picks singular or plural', () => {
    useLangStore.getState().setLang('en')
    expect(tn('{n} session', '{n} sessions', 1)).toBe('1 session')
    expect(tn('{n} session', '{n} sessions', 3)).toBe('3 sessions')
  })

  test('localizes month group labels', () => {
    useLangStore.getState().setLang('ko')
    expect(localizeDateGroup('October 2026')).toBe('2026년 10월')
    expect(localizeDateGroup('Today')).toBe('오늘')
  })
})
