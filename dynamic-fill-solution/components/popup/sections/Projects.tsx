import React from 'react';
import type { ProjectEntry } from '@/lib/storage/types';
import { FormField, TagListField } from '../FormField';
import ArraySection from '../ArraySection';
import { useI18n } from '@/lib/i18n';

interface ProjectsProps {
  data: ProjectEntry[];
  onChange: (items: ProjectEntry[]) => void;
}

function createEmptyProject(): ProjectEntry {
  return {
    name: '',
    projectType: '',
    experienceCategory: '',
    role: '',
    startDate: '',
    endDate: '',
    isCurrent: '',
    link: '',
    responsibilities: '',
    description: '',
    achievements: '',
    techStack: [],
    organization: '',
    advisor: '',
    teamSize: '',
    awards: '',
    confidentialityNote: '',
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-1 text-xs font-semibold text-[var(--sk-primary)]">{children}</div>;
}

export default function ProjectsSection({ data, onChange }: ProjectsProps) {
  const { t } = useI18n();

  const getTitle = (entry: ProjectEntry, index: number): string => {
    if (entry.name) {
      return `${entry.name}${entry.role ? ' · ' + entry.role : ''}`;
    }
    return `${t('projects.title')} ${index + 1}`;
  };

  return (
    <ArraySection<ProjectEntry>
      items={data}
      onUpdate={onChange}
      createEmpty={createEmptyProject}
      getTitle={getTitle}
      renderItem={(item, patch) => (
        <div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField
              label="项目 / 实践名称"
              value={item.name}
              onChange={(v) => patch({ name: v })}
            />
            <FormField
              label="经历类别"
              value={item.experienceCategory ?? ''}
              onChange={(v) => patch({ experienceCategory: v })}
            />
            <FormField
              label="项目类型 / 项目来源"
              value={item.projectType ?? ''}
              onChange={(v) => patch({ projectType: v })}
            />
            <FormField
              label="项目角色"
              value={item.role}
              onChange={(v) => patch({ role: v })}
            />
            <FormField
              label={t('projects.startDate')}
              value={item.startDate}
              onChange={(v) => patch({ startDate: v })}
              type="month"
            />
            <FormField
              label={t('projects.endDate')}
              value={item.endDate}
              onChange={(v) => patch({ endDate: v })}
              type="month"
            />
            <FormField
              label="是否至今"
              value={item.isCurrent ?? ''}
              onChange={(v) => patch({ isCurrent: v })}
            />
            <FormField
              label="所属组织 / 团队"
              value={item.organization ?? ''}
              onChange={(v) => patch({ organization: v })}
            />
          </div>
          <SectionTitle>项目内容</SectionTitle>
          <FormField
            label="项目描述 / 实践描述"
            value={item.description}
            onChange={(v) => patch({ description: v })}
            type="textarea"
            rows={4}
          />
          <FormField
            label="本人职责 / 项目职责"
            value={item.responsibilities ?? ''}
            onChange={(v) => patch({ responsibilities: v })}
            type="textarea"
            rows={4}
          />
          <FormField
            label="项目成果 / 主要成就"
            value={item.achievements ?? ''}
            onChange={(v) => patch({ achievements: v })}
            type="textarea"
            rows={3}
          />
          <TagListField
            label="技术栈 / 工具"
            tags={item.techStack}
            onChange={(v) => patch({ techStack: v })}
          />
          <SectionTitle>进阶信息</SectionTitle>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField
              label="项目链接 / 作品链接"
              value={item.link}
              onChange={(v) => patch({ link: v })}
            />
            <FormField
              label="指导老师"
              value={item.advisor ?? ''}
              onChange={(v) => patch({ advisor: v })}
            />
            <FormField
              label="团队规模"
              value={item.teamSize ?? ''}
              onChange={(v) => patch({ teamSize: v })}
            />
            <FormField
              label="获奖 / 排名"
              value={item.awards ?? ''}
              onChange={(v) => patch({ awards: v })}
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
