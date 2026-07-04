import React from 'react';
import type { AwardEntry, PublicationPatentEntry } from '@/lib/storage/types';
import AwardsSection from './Awards';
import PublicationsAndPatentsSection from './PublicationsAndPatents';
import { SectionBlock } from './SectionGroup';

interface AchievementsSectionProps {
  awards: AwardEntry[];
  publicationsAndPatents: PublicationPatentEntry[];
  onAwardsChange: (items: AwardEntry[]) => void;
  onPublicationsAndPatentsChange: (items: PublicationPatentEntry[]) => void;
}

export default function AchievementsSection({
  awards,
  publicationsAndPatents,
  onAwardsChange,
  onPublicationsAndPatentsChange,
}: AchievementsSectionProps) {
  return (
    <div>
      <SectionBlock title="奖项 / 竞赛 / 奖学金" description="奖项、竞赛、奖学金、荣誉称号等独立成果。">
        <AwardsSection data={awards} onChange={onAwardsChange} />
      </SectionBlock>
      <SectionBlock title="论文发表 / 专利发表" description="论文、专著、专利等科研成果。">
        <PublicationsAndPatentsSection
          data={publicationsAndPatents}
          onChange={onPublicationsAndPatentsChange}
        />
      </SectionBlock>
    </div>
  );
}
