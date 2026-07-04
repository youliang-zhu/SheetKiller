import React from 'react';
import type { PublicationPatentEntry } from '@/lib/storage/types';
import { FormField } from '../FormField';
import ArraySection from '../ArraySection';

interface PublicationsAndPatentsProps {
  data: PublicationPatentEntry[];
  onChange: (items: PublicationPatentEntry[]) => void;
}

function createEmptyPublicationPatent(): PublicationPatentEntry {
  return {
    type: '',
    title: '',
    date: '',
    venue: '',
    authorOrder: '',
    volumeOrIssue: '',
    description: '',
    patentNumber: '',
    urlOrDoi: '',
  };
}

export default function PublicationsAndPatentsSection({ data, onChange }: PublicationsAndPatentsProps) {
  const getTitle = (entry: PublicationPatentEntry, index: number): string => {
    if (entry.title) return `${entry.title}${entry.type ? ' - ' + entry.type : ''}`;
    return `论文发表 / 专利发表 ${index + 1}`;
  };

  return (
    <ArraySection<PublicationPatentEntry>
      items={data}
      onUpdate={onChange}
      createEmpty={createEmptyPublicationPatent}
      getTitle={getTitle}
      renderItem={(item, patch) => (
        <div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="成果类型" value={item.type} onChange={(v) => patch({ type: v })} />
            <FormField label="名称" value={item.title} onChange={(v) => patch({ title: v })} />
            <FormField label="发表 / 发布时间" value={item.date} onChange={(v) => patch({ date: v })} type="month" />
            <FormField label="期刊 / 会议 / 出版物" value={item.venue} onChange={(v) => patch({ venue: v })} />
            <FormField label="作者顺序" value={item.authorOrder} onChange={(v) => patch({ authorOrder: v })} />
            <FormField label="年度 / 期次" value={item.volumeOrIssue} onChange={(v) => patch({ volumeOrIssue: v })} />
            <FormField label="专利编号 / 申请号" value={item.patentNumber} onChange={(v) => patch({ patentNumber: v })} />
            <FormField label="链接 / DOI" value={item.urlOrDoi} onChange={(v) => patch({ urlOrDoi: v })} />
          </div>
          <FormField
            label="论文详情 / 专利描述"
            value={item.description}
            onChange={(v) => patch({ description: v })}
            type="textarea"
            rows={4}
          />
        </div>
      )}
    />
  );
}
