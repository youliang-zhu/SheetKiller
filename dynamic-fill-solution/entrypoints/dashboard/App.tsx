import './style.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Resume } from '@/lib/storage/types';
import { I18nContext, useI18nProvider } from '@/lib/i18n';
import {
  createResume,
  deleteResume,
  exportResume,
  getActiveResumeId,
  importResume,
  listResumes,
  renameResume,
  setActiveResumeId,
  updateResume,
} from '@/lib/storage/resume-store';
import { countFields } from '@/lib/storage/resume-utils';
import { extractResumeFields, toResume } from '@/lib/import/resume-extractor';
import { getSettings } from '@/lib/storage/settings-store';
import { completeProfileWithAi, mergeAiProfileCompletion } from '@/lib/import/ai-profile-completer';

import Sidebar, { type SectionId } from '@/components/popup/Sidebar';
import ResumeSelector from '@/components/popup/ResumeSelector';
import StatusBar from '@/components/popup/StatusBar';
import ImportDialog from '@/components/popup/ImportDialog';
import ProfileModeWorkbench, { type ProfileEditorMode } from '@/components/popup/ProfileModeWorkbench';

import BasicInfoSection from '@/components/popup/sections/BasicInfo';
import EducationSection from '@/components/popup/sections/Education';
import ExperienceSection from '@/components/popup/sections/ExperienceSection';
import AchievementsSection from '@/components/popup/sections/AchievementsSection';
import SkillsSection from '@/components/popup/sections/Skills';
import JobPreferenceSection from '@/components/popup/sections/JobPreference';
import SupplementalInfoSection from '@/components/popup/sections/SupplementalInfo';
import SettingsSection from '@/components/popup/sections/Settings';
import SavedPagesSection from '@/components/popup/sections/SavedPages';

const PROFILE_MODE_KEY = 'formpilot:profileEditorMode';

export default function App() {
  const i18n = useI18nProvider();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>('basic');
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<'json' | 'resume'>('resume');
  const [profileMode, setProfileMode] = useState<ProfileEditorMode>('manual');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [reviewCount, setReviewCount] = useState(0);

  // ─── Pending save refs (debounce race-condition fix) ──────────────────────
  const pendingRef = useRef<{ id: string; patch: Partial<Omit<Resume, 'meta'>> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const loadResumes = useCallback(async () => {
    const [all, storedActiveId] = await Promise.all([
      listResumes(),
      getActiveResumeId(),
    ]);
    setResumes(all);
    if (all.length > 0) {
      const resolvedId =
        storedActiveId && all.find((r) => r.meta.id === storedActiveId)
          ? storedActiveId
          : all[0].meta.id;
      setActiveId(resolvedId);
    }
  }, []);

  const refreshActiveResume = useCallback(async () => {
    if (!activeId) return;
    const all = await listResumes();
    setResumes(all);
  }, [activeId]);

  const activeResume = resumes.find((r) => r.meta.id === activeId) ?? null;

  // ─── Hash routing on mount ────────────────────────────────────────────────

  const VALID_SECTIONS: SectionId[] = [
    'basic', 'education', 'experience', 'achievements', 'skills',
    'jobPreference', 'supplemental', 'savedPages', 'settings',
  ];

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && (VALID_SECTIONS as string[]).includes(hash)) {
      setSection(hash as SectionId);
    }
  }, []);

  // Reflect section changes in the URL hash. Skip the very first render —
  // otherwise a deep link (#settings) flickers to the initial state's hash
  // (#basic) before the hash-read effect's setSection has committed.
  const didSyncHash = useRef(false);
  useEffect(() => {
    if (!didSyncHash.current) {
      didSyncHash.current = true;
      return;
    }
    if (typeof window === 'undefined') return;
    if (window.location.hash.slice(1) !== section) {
      window.history.replaceState(null, '', `#${section}`);
    }
  }, [section]);

  // Browser back / forward / manual URL edit → update the rendered section.
  useEffect(() => {
    function onHashChange() {
      const h = window.location.hash.slice(1);
      if ((VALID_SECTIONS as string[]).includes(h)) {
        setSection(h as SectionId);
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // ─── Cleanup pending-save timer on unmount ────────────────────────────────
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // ─── Load on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const [all, storedActiveId, storedMode] = await Promise.all([
        listResumes(),
        getActiveResumeId(),
        chrome.storage.local.get(PROFILE_MODE_KEY),
      ]);

      const mode = storedMode[PROFILE_MODE_KEY];
      if (mode === 'manual' || mode === 'import' || mode === 'ai') {
        setProfileMode(mode);
      }

      if (all.length === 0) {
        const created = await createResume(i18n.t('resume.default'));
        setResumes([created]);
        setActiveId(created.meta.id);
        await setActiveResumeId(created.meta.id);
      } else {
        setResumes(all);
        const resolvedId =
          storedActiveId && all.find((r) => r.meta.id === storedActiveId)
            ? storedActiveId
            : all[0].meta.id;
        setActiveId(resolvedId);
      }
    }
    init();
  }, []);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const flushPendingSave = useCallback(async () => {
    if (pendingRef.current) {
      const { id, patch } = pendingRef.current;
      pendingRef.current = null;
      clearTimeout(timerRef.current);
      await updateResume(id, patch);
    }
  }, []);

  const handleSelectResume = useCallback(async (id: string) => {
    await flushPendingSave();
    setActiveId(id);
    await setActiveResumeId(id);
  }, [flushPendingSave]);

  const handleCreateResume = useCallback(async () => {
    const name = `${i18n.t('resume.default')} ${resumes.length + 1}`;
    const created = await createResume(name);
    setResumes((prev) => [...prev, created]);
    setActiveId(created.meta.id);
    await setActiveResumeId(created.meta.id);
  }, [resumes.length]);

  const handleUpdate = useCallback(
    (patch: Partial<Omit<Resume, 'meta'>>) => {
      if (!activeId) return;
      setReviewCount(0);
      setResumes((prev) =>
        prev.map((r) =>
          r.meta.id === activeId
            ? { ...r, ...patch, meta: { ...r.meta, updatedAt: Date.now() } }
            : r,
        ),
      );
      pendingRef.current = { id: activeId, patch };
      clearTimeout(timerRef.current);
      setSaveStatus('saving');
      timerRef.current = setTimeout(async () => {
        if (pendingRef.current) {
          const { id, patch: p } = pendingRef.current;
          pendingRef.current = null;
          await updateResume(id, p);
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 1500);
        }
      }, 500);
    },
    [activeId],
  );

  const handleDeleteResume = useCallback(async (id: string) => {
    await flushPendingSave();
    await deleteResume(id);
    const remaining = resumes.filter((r) => r.meta.id !== id);
    setResumes(remaining);
    if (activeId === id) {
      const nextId = remaining.length > 0 ? remaining[0].meta.id : null;
      setActiveId(nextId);
      if (nextId) {
        await setActiveResumeId(nextId);
      } else {
        // No profiles left — clear the stored pointer so init() on next
        // launch doesn't chase an orphan id. (The UI's canDelete = > 1
        // guard normally prevents landing here, but be explicit.)
        await chrome.storage.local.remove('formpilot:activeResumeId');
      }
    }
  }, [flushPendingSave, resumes, activeId]);

  const handleRenameResume = useCallback(async (id: string, newName: string) => {
    // Flush any in-flight field edit first so the debounced updateResume
    // doesn't race the rename by writing a stale meta.name back.
    await flushPendingSave();
    try {
      const updated = await renameResume(id, newName);
      setResumes((prev) => prev.map((r) => (r.meta.id === id ? updated : r)));
    } catch (err) {
      console.error('Rename failed:', err);
    }
  }, [flushPendingSave]);

  const handleExport = useCallback(async () => {
    if (!activeId) return;
    try {
      const json = await exportResume(activeId);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const resume = resumes.find((r) => r.meta.id === activeId);
      a.download = `${resume?.meta.name ?? 'profile'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [activeId, resumes]);

  const handleModeChange = useCallback(async (mode: ProfileEditorMode) => {
    setProfileMode(mode);
    await chrome.storage.local.set({ [PROFILE_MODE_KEY]: mode });
  }, []);

  const openImportDialog = useCallback((mode: 'json' | 'resume') => {
    setImportMode(mode);
    setShowImport(true);
  }, []);

  const handleImportText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('请先粘贴简历文本');

    const extracted = extractResumeFields(trimmed);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const resumeName = extracted.basic.name || 'Imported Resume';
    const resume = toResume(extracted, id, resumeName);
    const imported = await importResume(JSON.stringify(resume));
    await setActiveResumeId(imported.meta.id);
    setActiveId(imported.meta.id);
    setReviewCount(countFields(imported).filled);
    await loadResumes();

    return {
      name: imported.meta.name,
      filledCount: countFields(imported).filled,
    };
  }, [loadResumes]);

  const handleAiImprove = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('请先粘贴待完善的资料文本');
    if (!activeId || !activeResume) throw new Error('请先选择一份资料');

    await flushPendingSave();
    const aiProfileResult = await chrome.runtime.sendMessage({
      type: 'AI_COMPLETE_PROFILE',
      resumeText: trimmed,
    });
    if (!aiProfileResult?.ok) {
      throw new Error(aiProfileResult?.error ?? 'AI 瀹屽杽璧勬枡澶辫触');
    }
    const aiProfileData = aiProfileResult.data as { filledCount: number; needsReview: number };
    setReviewCount(aiProfileData.needsReview);
    await refreshActiveResume();
    return aiProfileData;

    const settings = await getSettings();
    if (!settings.apiProvider || !settings.apiKey) {
      throw new Error('请先选择 AI 供应商并填写 API Key');
    }

    const providerDefaults = {
      openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5' },
      deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    } as const;
    const completion = await completeProfileWithAi(
      trimmed,
      settings,
      providerDefaults[settings.apiProvider],
    );
    const { patch, filledCount } = mergeAiProfileCompletion(activeResume, completion);
    await updateResume(activeId, patch);
    const data = { filledCount, needsReview: filledCount };
    setReviewCount(filledCount);
    await refreshActiveResume();
    return data;
  }, [activeId, activeResume, flushPendingSave, refreshActiveResume]);

  // ─── Render section content ───────────────────────────────────────────────

  function renderContent() {
    if (section === 'settings') {
      return <SettingsSection />;
    }

    if (section === 'savedPages') {
      return <SavedPagesSection />;
    }

    if (!activeResume) {
      return (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          {i18n.t('popup.noResume')}
        </div>
      );
    }

    switch (section) {
      case 'basic':
        return (
          <BasicInfoSection
            data={activeResume.basic}
            onChange={(patch) => handleUpdate({ basic: { ...activeResume.basic, ...patch } })}
            refreshFromStorage={refreshActiveResume}
          />
        );
      case 'education':
        return (
          <EducationSection
            data={activeResume.education}
            onChange={(items) => handleUpdate({ education: items })}
          />
        );
      case 'experience':
        return (
          <ExperienceSection
            work={activeResume.work ?? []}
            projects={activeResume.projects ?? []}
            campusActivities={activeResume.campusActivities ?? []}
            onWorkChange={(items) => handleUpdate({ work: items })}
            onProjectsChange={(items) => handleUpdate({ projects: items })}
            onCampusActivitiesChange={(items) => handleUpdate({ campusActivities: items })}
          />
        );
      case 'achievements':
        return (
          <AchievementsSection
            awards={activeResume.awards ?? []}
            publicationsAndPatents={activeResume.publicationsAndPatents ?? []}
            onAwardsChange={(items) => handleUpdate({ awards: items })}
            onPublicationsAndPatentsChange={(items) => handleUpdate({ publicationsAndPatents: items })}
          />
        );
      case 'skills':
        return (
          <SkillsSection
            data={activeResume.skills}
            onChange={(patch) => handleUpdate({ skills: { ...activeResume.skills, ...patch } })}
          />
        );
      case 'jobPreference':
        return (
          <JobPreferenceSection
            data={activeResume.jobPreference}
            onChange={(patch) =>
              handleUpdate({ jobPreference: { ...activeResume.jobPreference, ...patch } })
            }
          />
        );
      case 'supplemental':
        return (
          <SupplementalInfoSection
            familyMembers={activeResume.familyMembers ?? []}
            statements={activeResume.statements ?? {
              selfEvaluation: '',
              additionalNotes: '',
              motivation: '',
              careerPlan: '',
            }}
            custom={activeResume.custom ?? []}
            onFamilyMembersChange={(items) => handleUpdate({ familyMembers: items })}
            onStatementsChange={(patch) => handleUpdate({
              statements: {
                selfEvaluation: '',
                additionalNotes: '',
                motivation: '',
                careerPlan: '',
                ...(activeResume.statements ?? {}),
                ...patch,
              },
            })}
            onCustomChange={(items) => handleUpdate({ custom: items })}
          />
        );
      default:
        return null;
    }
  }

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <I18nContext.Provider value={i18n}>
    <div className="min-h-screen bg-[var(--sk-bg)] text-[var(--sk-text)] flex flex-col dashboard-shell">
      {/* Top header */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <span className="sk-display text-xl font-bold text-slate-950">{i18n.t('app.name')}</span>
          <div className="flex-1" />
          {/* Save indicator */}
          {saveStatus === 'saving' && <span className="text-xs text-slate-500">{i18n.t('status.saving')}</span>}
          {saveStatus === 'saved' && <span className="text-xs text-emerald-600">{i18n.t('status.saved')}</span>}
          {/* Resume selector in header */}
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <ResumeSelector
              resumes={resumes}
              activeId={activeId}
              onSelect={handleSelectResume}
              onCreate={handleCreateResume}
              onDelete={handleDeleteResume}
              onRename={handleRenameResume}
            />
          </div>
          {/* Settings — always reachable from the header */}
          <button
            onClick={() => setSection('settings')}
            title={i18n.t('nav.settings')}
            className={`px-3 py-2 rounded-2xl text-xs font-semibold transition-colors flex items-center gap-1 border
              ${section === 'settings'
                ? 'bg-[var(--sk-primary)] text-white border-[var(--sk-primary)]'
                : 'bg-white hover:bg-[#f8fbff] text-[var(--sk-muted)] border-[var(--sk-border)]'
              }`}
          >
            <span className="hidden sm:inline">{i18n.t('nav.settings')}</span>
          </button>
        </div>
      </div>

      {section !== 'settings' && section !== 'savedPages' && (
        <div className="max-w-6xl mx-auto w-full px-6 pt-6">
          <ProfileModeWorkbench
            mode={profileMode}
            saveStatus={saveStatus}
            reviewCount={reviewCount}
            onModeChange={handleModeChange}
            onImportText={handleImportText}
            onOpenFileImport={() => openImportDialog('resume')}
            onOpenJsonImport={() => openImportDialog('json')}
            onAiImprove={handleAiImprove}
          />
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 max-w-6xl mx-auto w-full px-6 py-6 gap-5">
        {/* Sidebar — sticky */}
        <div className="sticky top-6 h-[calc(100vh-3rem)]">
          <Sidebar active={section} onChange={setSection} className="w-52 h-full" />
        </div>

        {/* Content area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1">
            <div className="max-w-4xl rounded-[28px] border border-[var(--sk-border)] bg-white p-6 shadow-[0_16px_42px_rgba(15,23,42,0.08)]">
              {renderContent()}
            </div>
          </div>

          {/* Status bar — sticky at bottom */}
          <div className="sticky bottom-4 mt-5">
            <StatusBar
              resume={activeResume}
              onImport={() => openImportDialog('resume')}
              onExport={handleExport}
            />
          </div>
        </div>
      </div>

      {/* Import dialog */}
      {showImport && (
        <ImportDialog
          initialMode={importMode}
          onClose={() => setShowImport(false)}
          onImported={async () => {
            setShowImport(false);
            await loadResumes();
          }}
        />
      )}
    </div>
    </I18nContext.Provider>
  );
}
