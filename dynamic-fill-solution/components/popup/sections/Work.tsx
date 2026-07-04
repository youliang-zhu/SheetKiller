import React from 'react';
import type { WorkEntry } from '@/lib/storage/types';
import { FormField } from '../FormField';
import ArraySection from '../ArraySection';
import { useI18n } from '@/lib/i18n';

interface WorkProps {
  data: WorkEntry[];
  onChange: (items: WorkEntry[]) => void;
}

function createEmptyWork(): WorkEntry {
  return {
    company: '',
    companyEn: '',
    title: '',
    titleEn: '',
    experienceType: '',
    department: '',
    location: '',
    startDate: '',
    endDate: '',
    isCurrent: '',
    description: '',
    achievements: '',
    awards: '',
    competitionExperience: '',
    trainingAndCertifications: '',
    contactPerson: '',
    contactPhone: '',
    confidentialityNote: '',
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-1 text-xs font-semibold text-[var(--sk-primary)]">{children}</div>;
}

export default function WorkSection({ data, onChange }: WorkProps) {
  const { t } = useI18n();

  const getTitle = (entry: WorkEntry, index: number): string => {
    if (entry.company) {
      return `${entry.company}${entry.title ? ' · ' + entry.title : ''}`;
    }
    return `${t('work.title')} ${index + 1}`;
  };

  return (
    <ArraySection<WorkEntry>
      items={data}
      onUpdate={onChange}
      createEmpty={createEmptyWork}
      getTitle={getTitle}
      renderItem={(item, patch) => (
        <div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField
              label="单位名称"
              value={item.company}
              onChange={(v) => patch({ company: v })}
            />
            <FormField
              label="部门名称"
              value={item.department}
              onChange={(v) => patch({ department: v })}
            />
            <FormField
              label="岗位名称"
              value={item.title}
              onChange={(v) => patch({ title: v })}
            />
            <FormField
              label="经历类型 / 工作性质"
              value={item.experienceType ?? ''}
              onChange={(v) => patch({ experienceType: v })}
            />
            <FormField
              label="工作地点"
              value={item.location}
              onChange={(v) => patch({ location: v })}
            />
            <FormField
              label={t('work.startDate')}
              value={item.startDate}
              onChange={(v) => patch({ startDate: v })}
              type="month"
            />
            <FormField
              label={t('work.endDate')}
              value={item.endDate}
              onChange={(v) => patch({ endDate: v })}
              type="month"
            />
            <FormField
              label="是否至今"
              value={item.isCurrent ?? ''}
              onChange={(v) => patch({ isCurrent: v })}
            />
          </div>
          <SectionTitle>职责与成果</SectionTitle>
          <FormField
            label="工作描述 / 工作职责"
            value={item.description}
            onChange={(v) => patch({ description: v })}
            type="textarea"
            rows={4}
          />
          <FormField
            label="主要成就 / 取得成果"
            value={item.achievements ?? ''}
            onChange={(v) => patch({ achievements: v })}
            type="textarea"
            rows={3}
          />
          <FormField
            label="奖励与荣誉"
            value={item.awards ?? ''}
            onChange={(v) => patch({ awards: v })}
            type="textarea"
            rows={3}
          />
          <SectionTitle>低频与核验信息</SectionTitle>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField
              label="大赛经历"
              value={item.competitionExperience ?? ''}
              onChange={(v) => patch({ competitionExperience: v })}
            />
            <FormField
              label="专业培训认证"
              value={item.trainingAndCertifications ?? ''}
              onChange={(v) => patch({ trainingAndCertifications: v })}
            />
            <FormField
              label="单位联系人"
              value={item.contactPerson ?? ''}
              onChange={(v) => patch({ contactPerson: v })}
            />
            <FormField
              label="单位联系电话"
              value={item.contactPhone ?? ''}
              onChange={(v) => patch({ contactPhone: v })}
            />
          </div>
          <FormField
            label="保密说明 / 脱敏版描述"
            value={item.confidentialityNote ?? ''}
            onChange={(v) => patch({ confidentialityNote: v })}
            type="textarea"
            rows={3}
          />
        </div>
      )}
    />
  );
}
