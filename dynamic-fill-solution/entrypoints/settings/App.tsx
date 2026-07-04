import '../dashboard/style.css';
import React from 'react';
import { I18nContext, useI18nProvider } from '@/lib/i18n';
import SettingsSection from '@/components/popup/sections/Settings';

export default function App() {
  const i18n = useI18nProvider();

  return (
    <I18nContext.Provider value={i18n}>
      <div className="min-h-screen bg-[var(--sk-bg)] text-[var(--sk-text)]">
        <header className="border-b border-[var(--sk-border)] bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
            <span className="sk-display text-2xl font-bold">SheetKiller</span>
            <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[var(--sk-primary)]">
              API 设置
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-2xl border border-[var(--sk-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--sk-muted)] hover:bg-[#f8fbff] hover:text-[var(--sk-text)]"
            >
              关闭
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          <section className="mb-5 rounded-[28px] bg-white p-6 shadow-[0_16px_42px_rgba(15,23,42,0.08)] ring-1 ring-[var(--sk-border)]">
            <div className="max-w-3xl">
              <div className="sk-kicker mb-2">独立配置</div>
              <h1 className="text-2xl font-bold tracking-normal text-[var(--sk-text)]">
                配置 AI 供应商和调试工具
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--sk-muted)]">
                这里只管理 API Key、供应商、自动化偏好和测试调试包。个人资料请回到“编辑资料”维护。
              </p>
            </div>
          </section>

          <section className="rounded-[28px] bg-white p-6 shadow-[0_16px_42px_rgba(15,23,42,0.08)] ring-1 ring-[var(--sk-border)]">
            <SettingsSection />
          </section>
        </main>
      </div>
    </I18nContext.Provider>
  );
}
