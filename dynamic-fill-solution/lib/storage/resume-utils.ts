import type { Resume } from './types';

/**
 * Count filled vs total resume fields for completeness indicator.
 * Used by StatusBar (dashboard) and the popup App.
 */
export function countFields(resume: Resume): { filled: number; total: number } {
  let filled = 0;
  let total = 0;

  const countString = (v: string) => { total++; if (v && v.trim()) filled++; };
  const countArray = (v: unknown[]) => { total++; if (v.length > 0) filled++; };

  // Basic info
  const b = resume.basic;
  countString(b.name);
  countArray(b.phone);
  countArray(b.email);
  countString(b.gender);
  countString(b.birthday);
  countString(b.nationality);
  countString(b.ethnicity);
  countString(b.politicalStatus);
  countString(b.location);
  countString(b.nativePlace ?? '');
  countArray(b.willingLocations);

  // Education
  total++;
  if (resume.education.length > 0) filled++;

  // Work
  total++;
  if ((resume.work ?? []).length > 0) filled++;

  // Projects
  total++;
  if ((resume.projects ?? []).length > 0) filled++;

  total++;
  if ((resume.campusActivities ?? []).length > 0) filled++;

  total++;
  if ((resume.awards ?? []).length > 0) filled++;

  total++;
  if ((resume.publicationsAndPatents ?? []).length > 0) filled++;

  // Skills
  const s = resume.skills;
  countArray(s.languages);
  countArray(s.languageDetails ?? []);
  countArray(s.frameworks);
  countArray(s.tools);
  countArray(s.certificates);
  countArray(s.skillCertificates ?? []);

  // Job preference
  const j = resume.jobPreference;
  countArray(j.positions);
  countArray(j.industries);
  countString(j.salaryRange);
  countString(j.jobType);
  countString(j.availableDate);

  total++;
  if ((resume.familyMembers ?? []).length > 0) filled++;

  const statements = resume.statements ?? {
    selfEvaluation: '',
    additionalNotes: '',
    motivation: '',
    careerPlan: '',
  };
  countString(statements.selfEvaluation);
  countString(statements.additionalNotes);
  countString(statements.motivation);
  countString(statements.careerPlan);

  return { filled, total };
}
