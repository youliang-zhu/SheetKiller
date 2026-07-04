import React from 'react';
import type { EducationEntry } from '@/lib/storage/types';
import { FormField, TagListField } from '../FormField';
import ArraySection from '../ArraySection';
import { useI18n } from '@/lib/i18n';

interface EducationProps {
  data: EducationEntry[];
  onChange: (items: EducationEntry[]) => void;
}

function createEmptyEducation(): EducationEntry {
  return {
    school: '',
    schoolEn: '',
    schoolLocation: '',
    department: '',
    degree: '',
    educationLevel: '',
    educationType: '',
    majorCategory: '',
    major: '',
    majorEn: '',
    majorRank: '',
    gpa: '',
    gpaScale: '',
    startDate: '',
    endDate: '',
    isExchange: '',
    isJointProgram: '',
    hasNationalScholarship: '',
    isNationalKeyLab: '',
    advisor: '',
    laboratory: '',
    researchDirection: '',
    studentId: '',
    minorOrSecondMajor: '',
    honors: [],
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-1 text-xs font-semibold text-[var(--sk-primary)]">{children}</div>;
}

export default function EducationSection({ data, onChange }: EducationProps) {
  const { t } = useI18n();

  const getTitle = (entry: EducationEntry, index: number): string => {
    if (entry.school) {
      return `${entry.school}${entry.degree ? ' · ' + entry.degree : ''}`;
    }
    return `${t('education.title')} ${index + 1}`;
  };

  return (
    <ArraySection<EducationEntry>
      items={data}
      onUpdate={onChange}
      createEmpty={createEmptyEducation}
      getTitle={getTitle}
      renderItem={(item, patch) => (
        <div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField
              label="学校名称"
              value={item.school}
              onChange={(v) => patch({ school: v })}
            />
            <FormField
              label="学校所在地"
              value={item.schoolLocation ?? ''}
              onChange={(v) => patch({ schoolLocation: v })}
            />
            <FormField
              label="学历"
              value={item.educationLevel ?? ''}
              onChange={(v) => patch({ educationLevel: v })}
            />
            <FormField
              label="学位"
              value={item.degree}
              onChange={(v) => patch({ degree: v })}
            />
            <FormField
              label="学历类型"
              value={item.educationType ?? ''}
              onChange={(v) => patch({ educationType: v })}
            />
            <FormField
              label="所在院系"
              value={item.department ?? ''}
              onChange={(v) => patch({ department: v })}
            />
            <FormField
              label="专业名称"
              value={item.major}
              onChange={(v) => patch({ major: v })}
            />
            <FormField
              label="专业类别"
              value={item.majorCategory ?? ''}
              onChange={(v) => patch({ majorCategory: v })}
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <FormField
                  label="GPA / CGPA"
                  value={item.gpa}
                  onChange={(v) => patch({ gpa: v })}
                />
              </div>
              <div className="flex-1">
                <FormField
                  label={t('education.gpaScale')}
                  value={item.gpaScale}
                  onChange={(v) => patch({ gpaScale: v })}
                />
              </div>
            </div>
            <FormField
              label="专业排名 / 成绩排名"
              value={item.majorRank ?? ''}
              onChange={(v) => patch({ majorRank: v })}
            />
            <FormField
              label="开始日期"
              value={item.startDate}
              onChange={(v) => patch({ startDate: v })}
              type="month"
            />
            <FormField
              label="结束日期"
              value={item.endDate}
              onChange={(v) => patch({ endDate: v })}
              type="month"
            />
          </div>
          <SectionTitle>科研与特殊经历</SectionTitle>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField
              label="导师姓名"
              value={item.advisor ?? ''}
              onChange={(v) => patch({ advisor: v })}
            />
            <FormField
              label="实验室 / 课题组"
              value={item.laboratory ?? ''}
              onChange={(v) => patch({ laboratory: v })}
            />
            <FormField
              label="研究方向"
              value={item.researchDirection ?? ''}
              onChange={(v) => patch({ researchDirection: v })}
            />
            <FormField
              label="学号"
              value={item.studentId ?? ''}
              onChange={(v) => patch({ studentId: v })}
            />
            <FormField
              label="是否交流学习"
              value={item.isExchange ?? ''}
              onChange={(v) => patch({ isExchange: v })}
            />
            <FormField
              label="是否联合办学"
              value={item.isJointProgram ?? ''}
              onChange={(v) => patch({ isJointProgram: v })}
            />
            <FormField
              label="是否获得国家奖学金"
              value={item.hasNationalScholarship ?? ''}
              onChange={(v) => patch({ hasNationalScholarship: v })}
            />
            <FormField
              label="是否国家重点实验室"
              value={item.isNationalKeyLab ?? ''}
              onChange={(v) => patch({ isNationalKeyLab: v })}
            />
            <FormField
              label="主修 / 辅修 / 双学位"
              value={item.minorOrSecondMajor ?? ''}
              onChange={(v) => patch({ minorOrSecondMajor: v })}
            />
          </div>
          <TagListField
            label="荣誉奖项"
            tags={item.honors}
            onChange={(v) => patch({ honors: v })}
          />
        </div>
      )}
    />
  );
}
