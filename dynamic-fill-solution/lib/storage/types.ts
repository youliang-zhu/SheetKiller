import type { FieldCandidate } from '@/lib/capture/candidate';
import type { ApiProvider } from '@/lib/ai/provider-defaults';

// ─── Resume Meta ─────────────────────────────────────────────────────────────

export interface ResumeMeta {
  id: string;
  name: string;
  createdAt: number; // Unix ms timestamp
  updatedAt: number; // Unix ms timestamp
}

// ─── Basic Info ───────────────────────────────────────────────────────────────

export interface BasicInfo {
  name: string;
  nameEn: string;
  phone: FieldCandidate[];           // Phase B: multi-candidate
  phonePinnedId: string | null;      // Phase B
  email: FieldCandidate[];           // Phase B: multi-candidate
  emailPinnedId: string | null;      // Phase B
  gender: string;
  /** YYYY-MM-DD */
  birthday: string;
  /** Auto-calculable from birthday; can be stored explicitly */
  age: number;
  nationality: string;
  ethnicity: string;
  politicalStatus: string;
  location: string;
  nativePlace: string;
  willingLocations: string[];
  /** Base64-encoded avatar image */
  avatar: string;
  /** e.g. { github: 'https://...', linkedin: 'https://...' } */
  socialLinks: Record<string, string>;
}

// ─── Education ───────────────────────────────────────────────────────────────

export interface EducationEntry {
  school: string;
  schoolEn: string;
  schoolLocation: string;
  department: string;
  degree: string;
  educationLevel: string;
  educationType: string;
  majorCategory: string;
  major: string;
  majorEn: string;
  majorRank: string;
  gpa: string;
  gpaScale: string;
  startDate: string; // YYYY-MM
  endDate: string;   // YYYY-MM or 'present'
  isExchange: string;
  isJointProgram: string;
  hasNationalScholarship: string;
  isNationalKeyLab: string;
  advisor: string;
  laboratory: string;
  researchDirection: string;
  studentId: string;
  minorOrSecondMajor: string;
  honors: string[];
}

// ─── Work Experience ─────────────────────────────────────────────────────────

export interface WorkEntry {
  company: string;
  companyEn: string;
  title: string;
  titleEn: string;
  experienceType: string;
  department: string;
  startDate: string;
  endDate: string;
  isCurrent: string;
  description: string;
  achievements: string;
  awards: string;
  competitionExperience: string;
  trainingAndCertifications: string;
  contactPerson: string;
  contactPhone: string;
  confidentialityNote: string;
  location: string;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface ProjectEntry {
  name: string;
  projectType: string;
  experienceCategory: string;
  role: string;
  startDate: string;
  endDate: string;
  isCurrent: string;
  responsibilities: string;
  description: string;
  achievements: string;
  techStack: string[];
  link: string;
  organization: string;
  advisor: string;
  teamSize: string;
  awards: string;
  confidentialityNote: string;
}

export interface CampusActivityEntry {
  name: string;
  activityType: string;
  level: string;
  role: string;
  startDate: string;
  endDate: string;
  isCurrent: string;
  description: string;
  achievements: string;
}

export interface AwardEntry {
  name: string;
  awardType: string;
  level: string;
  rankOrGrade: string;
  date: string;
  issuer: string;
  description: string;
}

export interface PublicationPatentEntry {
  type: string;
  title: string;
  date: string;
  venue: string;
  authorOrder: string;
  volumeOrIssue: string;
  description: string;
  patentNumber: string;
  urlOrDoi: string;
}

export interface LanguageEntry {
  language: string;
  level: string;
  score: string;
  proficiency: string;
}

export interface SkillCertificateEntry {
  name: string;
  type: string;
  description: string;
  date: string;
  issuer: string;
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export interface Skills {
  languages: string[];
  languageDetails: LanguageEntry[];
  frameworks: string[];
  tools: string[];
  certificates: string[];
  skillCertificates: SkillCertificateEntry[];
}

export interface FamilyMemberEntry {
  relationship: string;
  name: string;
  ageOrBirthDate: string;
  politicalStatus: string;
  organizationAndDepartment: string;
  positionOrIdentity: string;
  phone: string;
}

export interface Statements {
  selfEvaluation: string;
  additionalNotes: string;
  motivation: string;
  careerPlan: string;
}

// ─── Job Preference ──────────────────────────────────────────────────────────

export interface JobPreference {
  positions: string[];
  industries: string[];
  salaryRange: string;
  jobType: string;
  availableDate: string;
}

// ─── Custom Fields ────────────────────────────────────────────────────────────

export interface CustomField {
  key: string;
  value: string;
}

// ─── Full Resume ─────────────────────────────────────────────────────────────

export interface Resume {
  meta: ResumeMeta;
  basic: BasicInfo;
  education: EducationEntry[];
  work: WorkEntry[];
  projects: ProjectEntry[];
  campusActivities: CampusActivityEntry[];
  awards: AwardEntry[];
  publicationsAndPatents: PublicationPatentEntry[];
  skills: Skills;
  jobPreference: JobPreference;
  familyMembers: FamilyMemberEntry[];
  statements: Statements;
  custom: CustomField[];
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface Settings {
  toolbarPosition: { x: number; y: number };
  apiKey: string;
  apiProvider: ApiProvider | '';
  apiBaseUrl: string;
  apiModel: string;
  skipSensitive: boolean;
  /**
   * Hostnames (suffix match: `mokahr.com` also matches `jobs.mokahr.com`)
   * where the floating toolbar auto-appears. Pages not in this list stay
   * dormant unless they have saved drafts/memory or the user triggers fill
   * from the popup.
   */
  allowedDomains: string[];
}

// ─── Factory & Defaults ──────────────────────────────────────────────────────

export function createEmptyResume(id: string, name: string): Resume {
  const now = Date.now();
  return {
    meta: {
      id,
      name,
      createdAt: now,
      updatedAt: now,
    },
    basic: {
      name: '',
      nameEn: '',
      phone: [],
      phonePinnedId: null,
      email: [],
      emailPinnedId: null,
      gender: '',
      birthday: '',
      age: 0,
      nationality: '',
      ethnicity: '',
      politicalStatus: '',
      location: '',
      nativePlace: '',
      willingLocations: [],
      avatar: '',
      socialLinks: {},
    },
    education: [],
    work: [],
    projects: [],
    campusActivities: [],
    awards: [],
    publicationsAndPatents: [],
    skills: {
      languages: [],
      languageDetails: [],
      frameworks: [],
      tools: [],
      certificates: [],
      skillCertificates: [],
    },
    jobPreference: {
      positions: [],
      industries: [],
      salaryRange: '',
      jobType: '',
      availableDate: '',
    },
    familyMembers: [],
    statements: {
      selfEvaluation: '',
      additionalNotes: '',
      motivation: '',
      careerPlan: '',
    },
    custom: [],
  };
}

export const DEFAULT_ALLOWED_DOMAINS = [
  // Chinese recruitment platforms
  'mokahr.com', 'moka.com', 'zhaopin.com', 'liepin.com', 'zhipin.com',
  'lagou.com', 'nowcoder.com',
  // International ATS
  'myworkday.com', 'myworkdayjobs.com', 'greenhouse.io', 'lever.co',
  'icims.com', 'taleo.net', 'smartrecruiters.com',
  // Chinese tech company career sites
  'hotjob.cn', 'beisen.com', 'feishu.cn',
];

export const DEFAULT_SETTINGS: Settings = {
  toolbarPosition: { x: 16, y: 80 },
  apiKey: '',
  apiProvider: '',
  apiBaseUrl: '',
  apiModel: '',
  skipSensitive: true,
  // Spread so callers can't mutate the DEFAULT_ALLOWED_DOMAINS module export
  // via a shared-reference bug.
  allowedDomains: [...DEFAULT_ALLOWED_DOMAINS],
};
