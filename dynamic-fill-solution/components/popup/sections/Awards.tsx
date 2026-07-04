import React from 'react';
import type { AwardEntry } from '@/lib/storage/types';
import { FormField } from '../FormField';
import ArraySection from '../ArraySection';

interface AwardsProps {
  data: AwardEntry[];
  onChange: (items: AwardEntry[]) => void;
}

function createEmptyAward(): AwardEntry {
  return {
    name: '',
    awardType: '',
    level: '',
    rankOrGrade: '',
    date: '',
    issuer: '',
    description: '',
  };
}

export default function AwardsSection({ data, onChange }: AwardsProps) {
  const getTitle = (entry: AwardEntry, index: number): string => {
    if (entry.name) return `${entry.name}${entry.rankOrGrade ? ' - ' + entry.rankOrGrade : ''}`;
    return `奖项 / 竞赛 / 奖学金 ${index + 1}`;
  };

  return (
    <ArraySection<AwardEntry>
      items={data}
      onUpdate={onChange}
      createEmpty={createEmptyAward}
      getTitle={getTitle}
      renderItem={(item, patch) => (
        <div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="名称" value={item.name} onChange={(v) => patch({ name: v })} />
            <FormField label="类型" value={item.awardType} onChange={(v) => patch({ awardType: v })} />
            <FormField label="级别" value={item.level} onChange={(v) => patch({ level: v })} />
            <FormField label="等级 / 名次" value={item.rankOrGrade} onChange={(v) => patch({ rankOrGrade: v })} />
            <FormField label="获奖时间" value={item.date} onChange={(v) => patch({ date: v })} type="month" />
            <FormField label="颁发机构 / 主办方" value={item.issuer} onChange={(v) => patch({ issuer: v })} />
          </div>
          <FormField
            label="描述"
            value={item.description}
            onChange={(v) => patch({ description: v })}
            type="textarea"
            rows={3}
          />
        </div>
      )}
    />
  );
}
