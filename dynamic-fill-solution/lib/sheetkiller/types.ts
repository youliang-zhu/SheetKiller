import type { InputType } from '@/lib/engine/adapters/types';

export type Confidence = 'high' | 'medium' | 'low';

export interface FieldInventoryItem {
  fieldId: string;
  index?: number;
  element: Element;
  inputType: InputType | 'file' | 'unknown';
  label: string;
  hint: string;
  placeholder: string;
  ariaLabel: string;
  name: string;
  id: string;
  section: string;
  context: string;
  htmlSnippet: string;
  options: string[];
  currentValue: string;
  required: boolean;
  visible: boolean;
  sensitiveType?:
    | 'id_card'
    | 'phone'
    | 'email'
    | 'password'
    | 'captcha'
    | 'verify_code'
    | 'bank_card'
    | 'upload';
  source: 'adapter' | 'heuristic' | 'generic-scan';
}

export interface ProfileFact {
  path: string;
  label: string;
  value: string;
  aliases: string[];
  sensitive: boolean;
  provenance: 'profile.json' | 'cv.md' | 'resume-import' | 'manual';
}

export interface LlmSafeProfileFact {
  path: string;
  label: string;
  aliases: string[];
  sensitive: boolean;
  hasValue: boolean;
  value?: string;
  provenance: ProfileFact['provenance'];
}

export type SerializableFieldInventoryItem = Omit<FieldInventoryItem, 'element'>;

export interface FillPlanItem {
  fieldId: string;
  index?: number;
  label?: string;
  profileSource: string;
  sourcePath?: string;
  expectedValue: string;
  value?: string;
  valueKind?: 'profile' | 'generated' | 'manual';
  strategy: InputType | 'cascader-region' | 'skip';
  confidence: Confidence;
  confidenceScore?: number;
  reason: string;
  source: 'adapter' | 'memory' | 'heuristic' | 'llm' | 'generated';
  searchValues?: string[];
  acceptValues?: string[];
  allowFreeText?: boolean;
  dependsOn?: number[];
  reviewRequired?: boolean;
  safety:
    | 'fill'
    | 'fill_requires_review'
    | 'needs_user_input'
    | 'skip_sensitive'
    | 'skip_upload'
    | 'skip_low_confidence'
    | 'skip_unknown'
    | 'skip_generated';
}

export type VerificationStatus =
  | 'verified'
  | 'mismatch'
  | 'unverifiable';

export interface VerificationResult {
  fieldId: string;
  expectedMasked: string;
  actualMasked: string;
  status: VerificationStatus;
  reason: string;
}

export interface SheetKillerReportItem {
  fieldId: string;
  label: string;
  profileSource?: string;
  expectedMasked?: string;
  actualMasked?: string;
  status:
    | 'filled_and_verified'
    | 'filled_but_mismatch'
    | 'filled_but_unverifiable'
    | 'needs_user_input'
    | 'skipped_low_confidence'
    | 'skipped_sensitive'
    | 'skipped_requires_human'
    | 'failed_to_fill';
  reason: string;
}
