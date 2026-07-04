import type { ProfileFact, LlmSafeProfileFact } from '@/lib/sheetkiller/types';
import type { Resume } from '@/lib/storage/types';
import { resolveCandidate } from '@/lib/capture/candidate';

const SENSITIVE_PATHS = /(id|身份证|phone|mobile|手机|email|邮箱|bank|银行卡)/i;

export function redactFactForLlm(fact: ProfileFact): LlmSafeProfileFact {
  if (fact.sensitive) {
    return {
      path: fact.path,
      label: fact.label,
      aliases: fact.aliases,
      sensitive: true,
      hasValue: Boolean(fact.value),
      provenance: fact.provenance,
    };
  }
  return {
    path: fact.path,
    label: fact.label,
    aliases: fact.aliases,
    sensitive: false,
    hasValue: Boolean(fact.value),
    value: fact.value,
    provenance: fact.provenance,
  };
}

export function redactFactsForLlm(facts: ProfileFact[]): LlmSafeProfileFact[] {
  return facts.map(redactFactForLlm);
}

export function factsFromRecord(
  record: Record<string, unknown>,
  provenance: ProfileFact['provenance'] = 'profile.json',
  prefix = '',
): ProfileFact[] {
  const facts: ProfileFact[] = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          facts.push(...factsFromRecord(item as Record<string, unknown>, provenance, `${path}[${index}]`));
        } else if (item !== '') {
          facts.push({
            path: `${path}[${index}]`,
            label: key,
            value: String(item),
            aliases: [key],
            sensitive: SENSITIVE_PATHS.test(path),
            provenance,
          });
        }
      });
      continue;
    }
    if (typeof value === 'object') {
      facts.push(...factsFromRecord(value as Record<string, unknown>, provenance, path));
      continue;
    }
    facts.push({
      path,
      label: key,
      value: String(value),
      aliases: [key],
      sensitive: SENSITIVE_PATHS.test(path),
      provenance,
    });
  }
  return facts;
}

function addFact(
  facts: ProfileFact[],
  path: string,
  label: string,
  value: unknown,
  aliases: string[] = [label],
  provenance: ProfileFact['provenance'] = 'profile.json',
): void {
  if (value === null || value === undefined || value === '') return;
  facts.push({
    path,
    label,
    value: Array.isArray(value) ? value.join(', ') : String(value),
    aliases,
    sensitive: SENSITIVE_PATHS.test(path),
    provenance,
  });
}

/**
 * Build planner-facing facts from the extension resume schema.
 *
 * Phone/email are stored as multi-candidate arrays in FormPilot. v2 planning
 * still wants stable profile paths like `basic.phone` and `basic.email`, so we
 * expose the resolved candidate there and keep the full recursive facts as
 * lower-priority detail for advanced matches.
 */
export function factsFromResume(resume: Resume): ProfileFact[] {
  const facts: ProfileFact[] = [];
  const phone = resolveCandidate(resume.basic.phone, resume.basic.phonePinnedId, '', {});
  const email = resolveCandidate(resume.basic.email, resume.basic.emailPinnedId, '', {});

  addFact(facts, 'basic.name', 'Name', resume.basic.name, ['name', 'full name', '姓名']);
  addFact(facts, 'basic.nameEn', 'English name', resume.basic.nameEn, ['english name', '英文名']);
  addFact(facts, 'basic.phone', 'Phone', phone?.value, ['phone', 'mobile', 'tel', '手机号', '电话']);
  addFact(facts, 'basic.email', 'Email', email?.value, ['email', 'mail', '邮箱']);
  addFact(facts, 'basic.gender', 'Gender', resume.basic.gender, ['gender', 'sex', '性别']);
  addFact(facts, 'basic.birthday', 'Birthday', resume.basic.birthday, ['birthday', 'birth date', '出生日期']);
  addFact(facts, 'basic.nationality', 'Nationality', resume.basic.nationality, ['nationality', '国籍']);
  addFact(facts, 'basic.ethnicity', 'Ethnicity', resume.basic.ethnicity, ['ethnicity', '民族']);
  addFact(facts, 'basic.politicalStatus', 'Political status', resume.basic.politicalStatus, ['political status', '政治面貌']);
  addFact(facts, 'basic.location', 'Current city', resume.basic.location, ['current city', 'location', '现居地']);
  addFact(facts, 'basic.nativePlace', 'Native place', resume.basic.nativePlace, ['native place', 'birthplace', '籍贯', '出生地']);
  addFact(facts, 'basic.willingLocations', 'Preferred cities', resume.basic.willingLocations, ['preferred city', '意向城市']);

  facts.push(...factsFromRecord({
    education: resume.education ?? [],
    work: resume.work ?? [],
    projects: resume.projects ?? [],
    campusActivities: resume.campusActivities ?? [],
    awards: resume.awards ?? [],
    publicationsAndPatents: resume.publicationsAndPatents ?? [],
    skills: resume.skills,
    jobPreference: resume.jobPreference,
    familyMembers: resume.familyMembers ?? [],
    statements: resume.statements ?? {},
    custom: Object.fromEntries((resume.custom ?? []).map((item) => [item.key, item.value])),
  }));

  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.path}:${fact.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveFactValue(facts: ProfileFact[], path: string): string {
  return facts.find((fact) => fact.path === path)?.value ?? '';
}
