import { describe, it, expect, afterEach } from 'vitest';
import { detectDefaultLocale, resolveLocale } from '@/lib/i18n';

// The tests/setup.ts mock stubs globalThis.chrome; we shim getUILanguage per-test.
const origGetUILanguage = chrome.i18n?.getUILanguage;

function setBrowserLang(lang: string | undefined): void {
  if (!chrome.i18n) {
    (chrome as unknown as { i18n: Record<string, unknown> }).i18n = {};
  }
  (chrome.i18n as unknown as { getUILanguage?: () => string }).getUILanguage =
    lang === undefined ? undefined : () => lang;
}

afterEach(() => {
  setBrowserLang(origGetUILanguage?.() ?? '');
});

describe('detectDefaultLocale', () => {
  it('returns zh for zh-CN', () => {
    setBrowserLang('zh-CN');
    expect(detectDefaultLocale()).toBe('zh');
  });

  it('returns zh for zh-TW', () => {
    setBrowserLang('zh-TW');
    expect(detectDefaultLocale()).toBe('zh');
  });

  it('returns zh for bare zh', () => {
    setBrowserLang('zh');
    expect(detectDefaultLocale()).toBe('zh');
  });

  it('returns zh for en-US in Chinese-only UI build', () => {
    setBrowserLang('en-US');
    expect(detectDefaultLocale()).toBe('zh');
  });

  it('returns zh for ja / fr / anything non-zh in Chinese-only UI build', () => {
    setBrowserLang('ja');
    expect(detectDefaultLocale()).toBe('zh');
    setBrowserLang('fr-FR');
    expect(detectDefaultLocale()).toBe('zh');
  });

  it('returns zh when chrome.i18n.getUILanguage is missing', () => {
    setBrowserLang(undefined);
    expect(detectDefaultLocale()).toBe('zh');
  });
});

describe('resolveLocale', () => {
  it('returns zh even when stale stored value is en', () => {
    expect(resolveLocale('zh')).toBe('zh');
    expect(resolveLocale('en')).toBe('zh');
  });

  it('falls back to zh when stored is undefined or invalid', () => {
    setBrowserLang('en-US');
    expect(resolveLocale(undefined)).toBe('zh');
    expect(resolveLocale(null)).toBe('zh');
    expect(resolveLocale('')).toBe('zh');
    expect(resolveLocale('xx')).toBe('zh');

    setBrowserLang('zh-CN');
    expect(resolveLocale(undefined)).toBe('zh');
    expect(resolveLocale('xx')).toBe('zh');
  });
});
