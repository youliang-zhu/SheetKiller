import React from 'react';
import type { CampusActivityEntry } from '@/lib/storage/types';
import { FormField } from '../FormField';
import ArraySection from '../ArraySection';

interface CampusActivitiesProps {
  data: CampusActivityEntry[];
  onChange: (items: CampusActivityEntry[]) => void;
}

function createEmptyCampusActivity(): CampusActivityEntry {
  return {
    name: '',
    activityType: '',
    level: '',
    role: '',
    startDate: '',
    endDate: '',
    isCurrent: '',
    description: '',
    achievements: '',
  };
}

export default function CampusActivitiesSection({ data, onChange }: CampusActivitiesProps) {
  const getTitle = (entry: CampusActivityEntry, index: number): string => {
    if (entry.name) return `${entry.name}${entry.role ? ' - ' + entry.role : ''}`;
    return `校园组织与活动 ${index + 1}`;
  };

  return (
    <ArraySection<CampusActivityEntry>
      items={data}
      onUpdate={onChange}
      createEmpty={createEmptyCampusActivity}
      getTitle={getTitle}
      renderItem={(item, patch) => (
        <div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="组织 / 活动名称" value={item.name} onChange={(v) => patch({ name: v })} />
            <FormField label="经历类型" value={item.activityType} onChange={(v) => patch({ activityType: v })} />
            <FormField label="级别" value={item.level} onChange={(v) => patch({ level: v })} />
            <FormField label="担任角色 / 职务" value={item.role} onChange={(v) => patch({ role: v })} />
            <FormField label="开始日期" value={item.startDate} onChange={(v) => patch({ startDate: v })} type="month" />
            <FormField label="结束日期" value={item.endDate} onChange={(v) => patch({ endDate: v })} type="month" />
            <FormField label="是否至今" value={item.isCurrent} onChange={(v) => patch({ isCurrent: v })} />
          </div>
          <FormField
            label="职责 / 活动内容"
            value={item.description}
            onChange={(v) => patch({ description: v })}
            type="textarea"
            rows={4}
          />
          <FormField
            label="成果 / 收获"
            value={item.achievements}
            onChange={(v) => patch({ achievements: v })}
            type="textarea"
            rows={3}
          />
        </div>
      )}
    />
  );
}
