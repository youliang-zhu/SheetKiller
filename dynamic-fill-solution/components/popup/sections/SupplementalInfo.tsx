import React from 'react';
import type { CustomField, FamilyMemberEntry, Statements } from '@/lib/storage/types';
import { FormField } from '../FormField';
import ArraySection from '../ArraySection';
import CustomFieldsSection from './CustomFields';
import { SectionBlock } from './SectionGroup';

interface SupplementalInfoProps {
  familyMembers: FamilyMemberEntry[];
  statements: Statements;
  custom: CustomField[];
  onFamilyMembersChange: (items: FamilyMemberEntry[]) => void;
  onStatementsChange: (patch: Partial<Statements>) => void;
  onCustomChange: (items: CustomField[]) => void;
}

function createEmptyFamilyMember(): FamilyMemberEntry {
  return {
    relationship: '',
    name: '',
    ageOrBirthDate: '',
    politicalStatus: '',
    organizationAndDepartment: '',
    positionOrIdentity: '',
    phone: '',
  };
}

function FamilyMembersSection({
  data,
  onChange,
}: {
  data: FamilyMemberEntry[];
  onChange: (items: FamilyMemberEntry[]) => void;
}) {
  const getTitle = (entry: FamilyMemberEntry, index: number): string => {
    if (entry.relationship || entry.name) return `${entry.relationship || '成员'}${entry.name ? ' - ' + entry.name : ''}`;
    return `家庭成员及社会关系 ${index + 1}`;
  };

  return (
    <ArraySection<FamilyMemberEntry>
      items={data}
      onUpdate={onChange}
      createEmpty={createEmptyFamilyMember}
      getTitle={getTitle}
      renderItem={(item, patch) => (
        <div className="grid gap-x-4 sm:grid-cols-2">
          <FormField label="称谓 / 关系" value={item.relationship} onChange={(v) => patch({ relationship: v })} />
          <FormField label="姓名" value={item.name} onChange={(v) => patch({ name: v })} />
          <FormField label="年龄 / 出生年月" value={item.ageOrBirthDate} onChange={(v) => patch({ ageOrBirthDate: v })} />
          <FormField label="政治面貌" value={item.politicalStatus} onChange={(v) => patch({ politicalStatus: v })} />
          <FormField label="现工作单位及部门" value={item.organizationAndDepartment} onChange={(v) => patch({ organizationAndDepartment: v })} />
          <FormField label="职务 / 身份" value={item.positionOrIdentity} onChange={(v) => patch({ positionOrIdentity: v })} />
          <FormField label="联系电话" value={item.phone} onChange={(v) => patch({ phone: v })} />
        </div>
      )}
    />
  );
}

export default function SupplementalInfoSection({
  familyMembers,
  statements,
  custom,
  onFamilyMembersChange,
  onStatementsChange,
  onCustomChange,
}: SupplementalInfoProps) {
  return (
    <div>
      <SectionBlock title="个人陈述 / 补充说明" description="个人自评、申请理由、职业规划和需要说明的其他事项。">
        <FormField
          label="个人自评"
          value={statements.selfEvaluation}
          onChange={(v) => onStatementsChange({ selfEvaluation: v })}
          type="textarea"
          rows={4}
        />
        <FormField
          label="需要说明的其他事项"
          value={statements.additionalNotes}
          onChange={(v) => onStatementsChange({ additionalNotes: v })}
          type="textarea"
          rows={4}
        />
        <FormField
          label="求职动机 / 申请理由"
          value={statements.motivation}
          onChange={(v) => onStatementsChange({ motivation: v })}
          type="textarea"
          rows={4}
        />
        <FormField
          label="职业规划"
          value={statements.careerPlan}
          onChange={(v) => onStatementsChange({ careerPlan: v })}
          type="textarea"
          rows={4}
        />
      </SectionBlock>
      <SectionBlock title="家庭成员及社会关系" description="敏感信息。只填写明确资料，不由 AI 猜测。">
        <FamilyMembersSection data={familyMembers} onChange={onFamilyMembersChange} />
      </SectionBlock>
      <SectionBlock title="自定义字段" description="用于承接个别平台的特殊问题。">
        <CustomFieldsSection data={custom} onChange={onCustomChange} />
      </SectionBlock>
    </div>
  );
}
