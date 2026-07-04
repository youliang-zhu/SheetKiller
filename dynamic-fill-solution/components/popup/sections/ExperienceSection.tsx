import React from 'react';
import type { CampusActivityEntry, ProjectEntry, WorkEntry } from '@/lib/storage/types';
import WorkSection from './Work';
import ProjectsSection from './Projects';
import CampusActivitiesSection from './CampusActivities';
import { SectionBlock } from './SectionGroup';

interface ExperienceSectionProps {
  work: WorkEntry[];
  projects: ProjectEntry[];
  campusActivities: CampusActivityEntry[];
  onWorkChange: (items: WorkEntry[]) => void;
  onProjectsChange: (items: ProjectEntry[]) => void;
  onCampusActivitiesChange: (items: CampusActivityEntry[]) => void;
}

export default function ExperienceSection({
  work,
  projects,
  campusActivities,
  onWorkChange,
  onProjectsChange,
  onCampusActivitiesChange,
}: ExperienceSectionProps) {
  return (
    <div>
      <SectionBlock title="实习 / 工作经历" description="企业、机构或正式岗位环境中的经历，例如 Volvo 实习。">
        <WorkSection data={work} onChange={onWorkChange} />
      </SectionBlock>
      <SectionBlock title="项目 / 在校实践" description="课程、科研、比赛、开源、校园实践或个人项目。">
        <ProjectsSection data={projects} onChange={onProjectsChange} />
      </SectionBlock>
      <SectionBlock title="校园组织与活动" description="学生干部、在校职务、社团、志愿服务和校内活动。">
        <CampusActivitiesSection data={campusActivities} onChange={onCampusActivitiesChange} />
      </SectionBlock>
    </div>
  );
}
