import type {
  CustomField,
  EducationEntry,
  FieldCandidate,
  AwardEntry,
  CampusActivityEntry,
  JobPreference,
  PublicationPatentEntry,
  ProjectEntry,
  Resume,
  Settings,
  Skills,
  FamilyMemberEntry,
  Statements,
  WorkEntry,
} from '@/lib/storage/types';

export interface AiProfileCompletion {
  basic?: {
    name?: string;
    nameEn?: string;
    phone?: string;
    email?: string;
    gender?: string;
    birthday?: string;
    nationality?: string;
    ethnicity?: string;
    politicalStatus?: string;
    location?: string;
    nativePlace?: string;
    willingLocations?: string[];
    socialLinks?: Record<string, string>;
  };
  education?: Partial<EducationEntry>[];
  work?: Partial<WorkEntry>[];
  projects?: Partial<ProjectEntry>[];
  campusActivities?: Partial<CampusActivityEntry>[];
  awards?: Partial<AwardEntry>[];
  publicationsAndPatents?: Partial<PublicationPatentEntry>[];
  skills?: Partial<Skills>;
  jobPreference?: Partial<JobPreference>;
  familyMembers?: Partial<FamilyMemberEntry>[];
  statements?: Partial<Statements>;
  custom?: Partial<CustomField>[];
}

export interface AiProfilePatchResult {
  patch: Partial<Omit<Resume, 'meta'>>;
  filledCount: number;
}

const PROFILE_SCHEMA_HINT = `{
  "basic": {
    "name": "", "nameEn": "", "phone": "", "email": "", "gender": "",
    "birthday": "YYYY-MM-DD", "nationality": "", "ethnicity": "",
    "politicalStatus": "", "location": "", "nativePlace": "", "willingLocations": [],
    "socialLinks": { "github": "", "linkedin": "", "portfolio": "" }
  },
  "education": [{
    "school": "", "schoolEn": "", "degree": "", "major": "", "majorEn": "",
    "gpa": "", "gpaScale": "", "startDate": "YYYY-MM", "endDate": "YYYY-MM",
    "honors": []
  }],
  "work": [{
    "company": "", "companyEn": "", "title": "", "titleEn": "",
    "department": "", "location": "", "startDate": "YYYY-MM",
    "endDate": "YYYY-MM", "description": ""
  }],
  "projects": [{
    "name": "", "role": "", "startDate": "YYYY-MM", "endDate": "YYYY-MM",
    "description": "", "techStack": [], "link": ""
  }],
  "skills": { "languages": [], "frameworks": [], "tools": [], "certificates": [] },
  "jobPreference": {
    "positions": [], "industries": [], "salaryRange": "", "jobType": "",
    "availableDate": ""
  },
  "custom": [{ "key": "", "value": "" }]
}`;

export async function completeProfileWithAi(
  resumeText: string,
  settings: Settings,
  providerDefaults: { baseUrl: string; model: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AiProfileCompletion> {
  const baseUrl = normalizeApiBaseUrl(settings.apiBaseUrl || providerDefaults.baseUrl);
  const model = (settings.apiModel || providerDefaults.model).trim();
  const apiKey = settings.apiKey.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'Extract a structured candidate profile from resume text.',
              'Return JSON only. Use empty strings or empty arrays for unknown fields.',
              'Do not invent facts. Keep source language when possible.',
              'Dates must be normalized to YYYY-MM-DD or YYYY-MM when the source supports it.',
              `Target JSON shape: ${PROFILE_SCHEMA_HINT}`,
            ].join('\n'),
          },
          { role: 'user', content: resumeText },
        ],
      }),
    });
  } catch (err) {
    throw new Error(formatAiProfileNetworkError(err, baseUrl));
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ? `: ${body.error.message}` : '';
    } catch {
      detail = '';
    }
    throw new Error(`AI profile completion failed: ${response.status}${detail}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI returned an empty profile completion.');
  }

  return JSON.parse(stripJsonFence(content)) as AiProfileCompletion;
}

function normalizeApiBaseUrl(value: string): string {
  return value
    .trim()
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/+$/, '');
}

function formatAiProfileNetworkError(err: unknown, baseUrl: string): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'AI 资料解析超时，请稍后重试，或检查当前网络和供应商接口状态。';
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `无法连接 AI 供应商接口：${baseUrl}。请检查网络、Base URL，或重新加载扩展后重试。`;
  }
  return `AI 资料解析请求失败：${message}`;
}

export function mergeAiProfileCompletion(
  current: Resume,
  completion: AiProfileCompletion,
): AiProfilePatchResult {
  let filledCount = 0;
  const count = (value: unknown) => {
    if (Array.isArray(value)) {
      if (value.length > 0) filledCount += value.length;
      return;
    }
    if (typeof value === 'string' && value.trim()) filledCount += 1;
  };

  const basic = { ...current.basic };
  const aiBasic = completion.basic ?? {};
  for (const key of [
    'name',
    'nameEn',
    'gender',
    'birthday',
    'nationality',
    'ethnicity',
    'politicalStatus',
    'location',
    'nativePlace',
  ] as const) {
    const value = cleanString(aiBasic[key]);
    if (value) {
      basic[key] = value;
      count(value);
    }
  }

  const phone = cleanString(aiBasic.phone);
  if (phone) {
    basic.phone = setSingleCandidate(current.basic.phone, phone);
    basic.phonePinnedId = basic.phone[0]?.id ?? null;
    count(phone);
  }
  const email = cleanString(aiBasic.email);
  if (email) {
    basic.email = setSingleCandidate(current.basic.email, email);
    basic.emailPinnedId = basic.email[0]?.id ?? null;
    count(email);
  }

  const willingLocations = cleanStringArray(aiBasic.willingLocations);
  if (willingLocations.length > 0) {
    basic.willingLocations = willingLocations;
    count(willingLocations);
  }

  const socialLinks = cleanRecord(aiBasic.socialLinks);
  if (Object.keys(socialLinks).length > 0) {
    basic.socialLinks = { ...current.basic.socialLinks, ...socialLinks };
    filledCount += Object.keys(socialLinks).length;
  }

  const education = normalizeArray(completion.education, normalizeEducation);
  const work = normalizeArray(completion.work, normalizeWork);
  const projects = normalizeArray(completion.projects, normalizeProject);
  const campusActivities = normalizeArray(completion.campusActivities, normalizeCampusActivity);
  const awards = normalizeArray(completion.awards, normalizeAward);
  const publicationsAndPatents = normalizeArray(completion.publicationsAndPatents, normalizePublicationPatent);
  const familyMembers = normalizeArray(completion.familyMembers, normalizeFamilyMember);
  const custom = normalizeArray(completion.custom, normalizeCustom);
  const skills = normalizeSkills(current.skills, completion.skills);
  const jobPreference = normalizeJobPreference(current.jobPreference, completion.jobPreference);
  const statements = normalizeStatements(current.statements, completion.statements);

  count(education);
  count(work);
  count(projects);
  count(campusActivities);
  count(awards);
  count(publicationsAndPatents);
  count(familyMembers);
  count(custom);
  filledCount += countSkillValues(skills, current.skills);
  filledCount += countJobPreferenceValues(jobPreference, current.jobPreference);
  filledCount += countStatementValues(statements, current.statements);

  const patch: Partial<Omit<Resume, 'meta'>> = { basic };
  if (education.length > 0) patch.education = education;
  if (work.length > 0) patch.work = work;
  if (projects.length > 0) patch.projects = projects;
  if (campusActivities.length > 0) patch.campusActivities = campusActivities;
  if (awards.length > 0) patch.awards = awards;
  if (publicationsAndPatents.length > 0) patch.publicationsAndPatents = publicationsAndPatents;
  if (familyMembers.length > 0) patch.familyMembers = familyMembers;
  if (custom.length > 0) patch.custom = custom;
  patch.skills = skills;
  patch.jobPreference = jobPreference;
  patch.statements = statements;

  return { patch, filledCount };
}

function stripJsonFence(content: string): string {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(cleanString).filter(Boolean)))
    : [];
}

function cleanRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const v = cleanString(raw);
    if (v) out[key] = v;
  }
  return out;
}

function setSingleCandidate(existing: FieldCandidate[], value: string): FieldCandidate[] {
  const now = Date.now();
  const current = existing.find((item) => item.value === value) ?? existing[0];
  return [{
    id: current?.id ?? crypto.randomUUID(),
    value,
    label: '',
    hitCount: current?.hitCount ?? 0,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    lastUrl: current?.lastUrl ?? '(ai-profile)',
  }];
}

function normalizeArray<TIn, TOut>(value: TIn[] | undefined, mapper: (item: TIn) => TOut | null): TOut[] {
  return Array.isArray(value) ? value.map(mapper).filter((item): item is TOut => item !== null) : [];
}

function normalizeEducation(item: Partial<EducationEntry>): EducationEntry | null {
  const entry: EducationEntry = {
    school: cleanString(item.school),
    schoolEn: cleanString(item.schoolEn),
    schoolLocation: cleanString(item.schoolLocation),
    department: cleanString(item.department),
    degree: cleanString(item.degree),
    educationLevel: cleanString(item.educationLevel),
    educationType: cleanString(item.educationType),
    majorCategory: cleanString(item.majorCategory),
    major: cleanString(item.major),
    majorEn: cleanString(item.majorEn),
    majorRank: cleanString(item.majorRank),
    gpa: cleanString(item.gpa),
    gpaScale: cleanString(item.gpaScale),
    startDate: cleanString(item.startDate),
    endDate: cleanString(item.endDate),
    isExchange: cleanString(item.isExchange),
    isJointProgram: cleanString(item.isJointProgram),
    hasNationalScholarship: cleanString(item.hasNationalScholarship),
    isNationalKeyLab: cleanString(item.isNationalKeyLab),
    advisor: cleanString(item.advisor),
    laboratory: cleanString(item.laboratory),
    researchDirection: cleanString(item.researchDirection),
    studentId: cleanString(item.studentId),
    minorOrSecondMajor: cleanString(item.minorOrSecondMajor),
    honors: cleanStringArray(item.honors),
  };
  return hasAny(entry) ? entry : null;
}

function normalizeWork(item: Partial<WorkEntry>): WorkEntry | null {
  const entry: WorkEntry = {
    company: cleanString(item.company),
    companyEn: cleanString(item.companyEn),
    title: cleanString(item.title),
    titleEn: cleanString(item.titleEn),
    experienceType: cleanString(item.experienceType),
    department: cleanString(item.department),
    location: cleanString(item.location),
    startDate: cleanString(item.startDate),
    endDate: cleanString(item.endDate),
    isCurrent: cleanString(item.isCurrent),
    description: cleanString(item.description),
    achievements: cleanString(item.achievements),
    awards: cleanString(item.awards),
    competitionExperience: cleanString(item.competitionExperience),
    trainingAndCertifications: cleanString(item.trainingAndCertifications),
    contactPerson: cleanString(item.contactPerson),
    contactPhone: cleanString(item.contactPhone),
    confidentialityNote: cleanString(item.confidentialityNote),
  };
  return hasAny(entry) ? entry : null;
}

function normalizeProject(item: Partial<ProjectEntry>): ProjectEntry | null {
  const entry: ProjectEntry = {
    name: cleanString(item.name),
    projectType: cleanString(item.projectType),
    experienceCategory: cleanString(item.experienceCategory),
    role: cleanString(item.role),
    startDate: cleanString(item.startDate),
    endDate: cleanString(item.endDate),
    isCurrent: cleanString(item.isCurrent),
    responsibilities: cleanString(item.responsibilities),
    description: cleanString(item.description),
    achievements: cleanString(item.achievements),
    techStack: cleanStringArray(item.techStack),
    link: cleanString(item.link),
    organization: cleanString(item.organization),
    advisor: cleanString(item.advisor),
    teamSize: cleanString(item.teamSize),
    awards: cleanString(item.awards),
    confidentialityNote: cleanString(item.confidentialityNote),
  };
  return hasAny(entry) ? entry : null;
}

function normalizeCampusActivity(item: Partial<CampusActivityEntry>): CampusActivityEntry | null {
  const entry: CampusActivityEntry = {
    name: cleanString(item.name),
    activityType: cleanString(item.activityType),
    level: cleanString(item.level),
    role: cleanString(item.role),
    startDate: cleanString(item.startDate),
    endDate: cleanString(item.endDate),
    isCurrent: cleanString(item.isCurrent),
    description: cleanString(item.description),
    achievements: cleanString(item.achievements),
  };
  return hasAny(entry) ? entry : null;
}

function normalizeAward(item: Partial<AwardEntry>): AwardEntry | null {
  const entry: AwardEntry = {
    name: cleanString(item.name),
    awardType: cleanString(item.awardType),
    level: cleanString(item.level),
    rankOrGrade: cleanString(item.rankOrGrade),
    date: cleanString(item.date),
    issuer: cleanString(item.issuer),
    description: cleanString(item.description),
  };
  return hasAny(entry) ? entry : null;
}

function normalizePublicationPatent(item: Partial<PublicationPatentEntry>): PublicationPatentEntry | null {
  const entry: PublicationPatentEntry = {
    type: cleanString(item.type),
    title: cleanString(item.title),
    date: cleanString(item.date),
    venue: cleanString(item.venue),
    authorOrder: cleanString(item.authorOrder),
    volumeOrIssue: cleanString(item.volumeOrIssue),
    description: cleanString(item.description),
    patentNumber: cleanString(item.patentNumber),
    urlOrDoi: cleanString(item.urlOrDoi),
  };
  return hasAny(entry) ? entry : null;
}

function normalizeFamilyMember(item: Partial<FamilyMemberEntry>): FamilyMemberEntry | null {
  const entry: FamilyMemberEntry = {
    relationship: cleanString(item.relationship),
    name: cleanString(item.name),
    ageOrBirthDate: cleanString(item.ageOrBirthDate),
    politicalStatus: cleanString(item.politicalStatus),
    organizationAndDepartment: cleanString(item.organizationAndDepartment),
    positionOrIdentity: cleanString(item.positionOrIdentity),
    phone: cleanString(item.phone),
  };
  return hasAny(entry) ? entry : null;
}

function normalizeCustom(item: Partial<CustomField>): CustomField | null {
  const entry = { key: cleanString(item.key), value: cleanString(item.value) };
  return entry.key && entry.value ? entry : null;
}

function normalizeSkills(current: Skills, value: Partial<Skills> | undefined): Skills {
  if (!value) return current;
  return {
    languages: mergeList(current.languages, value.languages),
    languageDetails: normalizeArray(value.languageDetails, (item) => {
      const entry = {
        language: cleanString(item.language),
        level: cleanString(item.level),
        score: cleanString(item.score),
        proficiency: cleanString(item.proficiency),
      };
      return hasAny(entry) ? entry : null;
    }).length > 0 ? normalizeArray(value.languageDetails, (item) => {
      const entry = {
        language: cleanString(item.language),
        level: cleanString(item.level),
        score: cleanString(item.score),
        proficiency: cleanString(item.proficiency),
      };
      return hasAny(entry) ? entry : null;
    }) : (current.languageDetails ?? []),
    frameworks: mergeList(current.frameworks, value.frameworks),
    tools: mergeList(current.tools, value.tools),
    certificates: mergeList(current.certificates, value.certificates),
    skillCertificates: normalizeArray(value.skillCertificates, (item) => {
      const entry = {
        name: cleanString(item.name),
        type: cleanString(item.type),
        description: cleanString(item.description),
        date: cleanString(item.date),
        issuer: cleanString(item.issuer),
      };
      return hasAny(entry) ? entry : null;
    }).length > 0 ? normalizeArray(value.skillCertificates, (item) => {
      const entry = {
        name: cleanString(item.name),
        type: cleanString(item.type),
        description: cleanString(item.description),
        date: cleanString(item.date),
        issuer: cleanString(item.issuer),
      };
      return hasAny(entry) ? entry : null;
    }) : (current.skillCertificates ?? []),
  };
}

function normalizeStatements(current: Statements | undefined, value: Partial<Statements> | undefined): Statements {
  const fallback = current ?? {
    selfEvaluation: '',
    additionalNotes: '',
    motivation: '',
    careerPlan: '',
  };
  if (!value) return fallback;
  return {
    selfEvaluation: cleanString(value.selfEvaluation) || fallback.selfEvaluation,
    additionalNotes: cleanString(value.additionalNotes) || fallback.additionalNotes,
    motivation: cleanString(value.motivation) || fallback.motivation,
    careerPlan: cleanString(value.careerPlan) || fallback.careerPlan,
  };
}

function normalizeJobPreference(
  current: JobPreference,
  value: Partial<JobPreference> | undefined,
): JobPreference {
  if (!value) return current;
  return {
    positions: cleanStringArray(value.positions).length > 0
      ? cleanStringArray(value.positions)
      : current.positions,
    industries: cleanStringArray(value.industries).length > 0
      ? cleanStringArray(value.industries)
      : current.industries,
    salaryRange: cleanString(value.salaryRange) || current.salaryRange,
    jobType: cleanString(value.jobType) || current.jobType,
    availableDate: cleanString(value.availableDate) || current.availableDate,
  };
}

function mergeList(current: string[], incoming: unknown): string[] {
  const cleaned = cleanStringArray(incoming);
  return cleaned.length > 0 ? Array.from(new Set([...current, ...cleaned])) : current;
}

function hasAny(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    return typeof item === 'string' && item.trim().length > 0;
  });
}

function countSkillValues(next: Skills, current: Skills): number {
  return (
    Math.max(0, next.languages.length - current.languages.length)
    + Math.max(0, (next.languageDetails ?? []).length - (current.languageDetails ?? []).length)
    + Math.max(0, next.frameworks.length - current.frameworks.length)
    + Math.max(0, next.tools.length - current.tools.length)
    + Math.max(0, next.certificates.length - current.certificates.length)
    + Math.max(0, (next.skillCertificates ?? []).length - (current.skillCertificates ?? []).length)
  );
}

function countJobPreferenceValues(next: JobPreference, current: JobPreference): number {
  return (
    Math.max(0, next.positions.length - current.positions.length)
    + Math.max(0, next.industries.length - current.industries.length)
    + (next.salaryRange !== current.salaryRange && next.salaryRange ? 1 : 0)
    + (next.jobType !== current.jobType && next.jobType ? 1 : 0)
    + (next.availableDate !== current.availableDate && next.availableDate ? 1 : 0)
  );
}

function countStatementValues(next: Statements, current: Statements | undefined): number {
  const fallback = current ?? {
    selfEvaluation: '',
    additionalNotes: '',
    motivation: '',
    careerPlan: '',
  };
  return (
    (next.selfEvaluation !== fallback.selfEvaluation && next.selfEvaluation ? 1 : 0)
    + (next.additionalNotes !== fallback.additionalNotes && next.additionalNotes ? 1 : 0)
    + (next.motivation !== fallback.motivation && next.motivation ? 1 : 0)
    + (next.careerPlan !== fallback.careerPlan && next.careerPlan ? 1 : 0)
  );
}
