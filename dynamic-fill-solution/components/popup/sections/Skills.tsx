import React from 'react';
import type { LanguageEntry, SkillCertificateEntry, Skills } from '@/lib/storage/types';
import { FormField, TagListField } from '../FormField';
import ArraySection from '../ArraySection';
import { SectionBlock } from './SectionGroup';

interface SkillsProps {
  data: Skills;
  onChange: (patch: Partial<Skills>) => void;
}

export default function SkillsSection({ data, onChange }: SkillsProps) {
  return (
    <div>
      <SectionBlock title="语言能力" description="语种、等级、成绩和熟练程度。">
        <ArraySection<LanguageEntry>
          items={data.languageDetails ?? []}
          onUpdate={(items) => onChange({ languageDetails: items })}
          createEmpty={() => ({ language: '', level: '', score: '', proficiency: '' })}
          getTitle={(item, index) => item.language || `语言能力 ${index + 1}`}
          renderItem={(item, patch) => (
            <div className="grid gap-x-4 sm:grid-cols-2">
              <FormField label="语种" value={item.language} onChange={(v) => patch({ language: v })} />
              <FormField label="语言等级 / 证书等级" value={item.level} onChange={(v) => patch({ level: v })} />
              <FormField label="语言成绩" value={item.score} onChange={(v) => patch({ score: v })} />
              <FormField label="熟练程度" value={item.proficiency} onChange={(v) => patch({ proficiency: v })} />
            </div>
          )}
        />
      </SectionBlock>

      <SectionBlock title="技能标签" description="可快速维护技术栈、工具、框架等关键词。">
        <TagListField
          label="编程语言 / 外语关键词"
          tags={data.languages}
          onChange={(v) => onChange({ languages: v })}
        />
        <TagListField
          label="框架 / 平台"
          tags={data.frameworks}
          onChange={(v) => onChange({ frameworks: v })}
        />
        <TagListField
          label="工具"
          tags={data.tools}
          onChange={(v) => onChange({ tools: v })}
        />
        <TagListField
          label="证书关键词"
          tags={data.certificates}
          onChange={(v) => onChange({ certificates: v })}
        />
      </SectionBlock>

      <SectionBlock title="其他技能 / 证书" description="证书、资格认证、技能熟练度等结构化信息。">
        <ArraySection<SkillCertificateEntry>
          items={data.skillCertificates ?? []}
          onUpdate={(items) => onChange({ skillCertificates: items })}
          createEmpty={() => ({ name: '', type: '', description: '', date: '', issuer: '' })}
          getTitle={(item, index) => item.name || `其他技能 / 证书 ${index + 1}`}
          renderItem={(item, patch) => (
            <div>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <FormField label="技能 / 证书名称" value={item.name} onChange={(v) => patch({ name: v })} />
                <FormField label="类型" value={item.type} onChange={(v) => patch({ type: v })} />
                <FormField label="获取时间" value={item.date} onChange={(v) => patch({ date: v })} type="month" />
                <FormField label="发证机构" value={item.issuer} onChange={(v) => patch({ issuer: v })} />
              </div>
              <FormField
                label="说明"
                value={item.description}
                onChange={(v) => patch({ description: v })}
                type="textarea"
                rows={3}
              />
            </div>
          )}
        />
      </SectionBlock>
    </div>
  );
}
