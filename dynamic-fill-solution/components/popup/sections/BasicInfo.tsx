import React from 'react';
import type { BasicInfo } from '@/lib/storage/types';
import type { FieldCandidate } from '@/lib/capture/candidate';
import { resolveCandidate } from '@/lib/capture/candidate';
import { FormField, TagListField } from '../FormField';
import { useI18n } from '@/lib/i18n';

interface BasicInfoProps {
  data: BasicInfo;
  onChange: (patch: Partial<BasicInfo>) => void;
  refreshFromStorage: () => Promise<void>;
}

export default function BasicInfoSection({ data, onChange }: BasicInfoProps) {
  const { t } = useI18n();

  const updateSocialLink = (key: string, value: string) => {
    const updated = { ...data.socialLinks };
    if (value.trim()) {
      updated[key] = value;
    } else {
      delete updated[key];
    }
    onChange({ socialLinks: updated });
  };

  const contactValue = (items: FieldCandidate[], pinnedId: string | null) =>
    resolveCandidate(items, pinnedId, '', {})?.value ?? '';

  const updateContact = (
    key: 'phone' | 'email',
    pinnedKey: 'phonePinnedId' | 'emailPinnedId',
    value: string,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) {
      onChange({ [key]: [], [pinnedKey]: null } as Partial<BasicInfo>);
      return;
    }
    const existing = resolveCandidate(data[key], data[pinnedKey], '', {}) ?? data[key][0];
    const now = Date.now();
    const candidate: FieldCandidate = {
      id: existing?.id ?? crypto.randomUUID(),
      value: trimmed,
      label: '',
      hitCount: existing?.hitCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastUrl: existing?.lastUrl ?? '(manual)',
    };
    onChange({ [key]: [candidate], [pinnedKey]: candidate.id } as Partial<BasicInfo>);
  };

  return (
    <div>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField
          label={t('basic.name')}
          value={data.name}
          onChange={(v) => onChange({ name: v })}
        />
        <FormField
          label={t('basic.phone')}
          value={contactValue(data.phone, data.phonePinnedId)}
          onChange={(v) => updateContact('phone', 'phonePinnedId', v)}
        />
        <FormField
          label={t('basic.email')}
          value={contactValue(data.email, data.emailPinnedId)}
          onChange={(v) => updateContact('email', 'emailPinnedId', v)}
        />
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField
          label={t('basic.gender')}
          value={data.gender}
          onChange={(v) => onChange({ gender: v })}
        />
        <FormField
          label={t('basic.birthday')}
          value={data.birthday}
          onChange={(v) => onChange({ birthday: v })}
          type="date"
        />
        <FormField
          label={t('basic.nationality')}
          value={data.nationality}
          onChange={(v) => onChange({ nationality: v })}
        />
        <FormField
          label={t('basic.ethnicity')}
          value={data.ethnicity}
          onChange={(v) => onChange({ ethnicity: v })}
        />
        <FormField
          label={t('basic.politicalStatus')}
          value={data.politicalStatus}
          onChange={(v) => onChange({ politicalStatus: v })}
        />
        <FormField
          label={t('basic.location')}
          value={data.location}
          onChange={(v) => onChange({ location: v })}
        />
        <FormField
          label={t('basic.nativePlace')}
          value={data.nativePlace ?? ''}
          onChange={(v) => onChange({ nativePlace: v })}
        />
      </div>
      <TagListField
        label={t('basic.willingLocations')}
        tags={data.willingLocations}
        onChange={(v) => onChange({ willingLocations: v })}
      />
      <p className="mb-3 text-xs font-semibold text-slate-500">{t('basic.socialLinks')}</p>
      <FormField
        label={t('basic.socialLinks.github')}
        value={data.socialLinks['github'] ?? ''}
        onChange={(v) => updateSocialLink('github', v)}
      />
      <FormField
        label={t('basic.socialLinks.linkedin')}
        value={data.socialLinks['linkedin'] ?? ''}
        onChange={(v) => updateSocialLink('linkedin', v)}
      />
      <FormField
        label={t('basic.socialLinks.portfolio')}
        value={data.socialLinks['portfolio'] ?? ''}
        onChange={(v) => updateSocialLink('portfolio', v)}
      />
    </div>
  );
}
