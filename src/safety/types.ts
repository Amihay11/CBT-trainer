/**
 * AI Safety Guardrail — Shared Types
 * ==================================
 *
 * These types model the output of a pre-LLM clinical triage layer. Every free-text input a
 * patient submits passes through `validateTherapeuticInput` (System 1 + System 2) BEFORE any
 * generative model sees it. A high-risk classification short-circuits generation entirely and
 * routes the patient to human/emergency help — the LLM must never be the crisis responder.
 */

/** Risk categories the classifier can raise, ordered loosely by acuity. */
export const RiskCategory = {
  NONE: 'none',
  /** Acute panic / severe anxiety — supportive, non-escalating, but flagged. */
  SEVERE_PANIC: 'severe_panic',
  /** Non-suicidal self-injury. */
  NSSI: 'nssi',
  /** Suicidal ideation / intent. Highest acuity. */
  SUICIDAL_IDEATION: 'suicidal_ideation',
  /** Threat/violence toward others. */
  HARM_TO_OTHERS: 'harm_to_others',
  /** Delusions / hallucinations — handled per READI (do not confront, do not validate). */
  PSYCHOSIS: 'psychosis',
  /** Attempt to jailbreak / prompt-inject the system out of its clinical guardrails. */
  PROMPT_INJECTION: 'prompt_injection',
} as const;

export type RiskCategoryValue = (typeof RiskCategory)[keyof typeof RiskCategory];

/** Where a flagged input should be routed. */
export const EscalationPath = {
  NONE: 'NONE',
  /** Immediate hotline hand-off (e.g. IL 1201 / US 988). Blocks generative processing. */
  URGENT_HOTLINE: 'URGENT_HOTLINE',
  /** Route to a human clinician within the app's supported care model (non-immediate). */
  HUMAN_CLINICIAN: 'HUMAN_CLINICIAN',
  /** READI-compliant psychosis response: de-escalate and offer human care, do not confront. */
  READI_SUPPORT: 'READI_SUPPORT',
  /** Reject the input and re-assert guardrails (jailbreak attempt). */
  REJECT_AND_REASSERT: 'REJECT_AND_REASSERT',
} as const;

export type EscalationPathValue = (typeof EscalationPath)[keyof typeof EscalationPath];

/** Which guardrail layer produced the decisive signal (for observability/audit). */
export const DetectionLayer = {
  SYSTEM_1_LEXICAL: 'system_1_lexical',
  SYSTEM_2_CLASSIFIER: 'system_2_classifier',
} as const;

export type DetectionLayerValue = (typeof DetectionLayer)[keyof typeof DetectionLayer];

/** A single detection signal, retained for the immutable audit log. */
export interface SafetySignal {
  readonly category: RiskCategoryValue;
  readonly layer: DetectionLayerValue;
  /** 0–1 confidence. System 1 (lexical) is treated as ~1.0 on match. */
  readonly confidence: number;
  /** Non-identifying reason string. Must NOT echo raw PHI into logs. */
  readonly rationale: string;
}

/**
 * The verdict returned to the caller. When `isSafe` is false, the app must render the
 * escalation UI for `escalationPath` and must not forward the text to any LLM.
 */
export interface SafetyReport {
  readonly isSafe: boolean;
  readonly requiresEscalation: boolean;
  readonly escalationPath: EscalationPathValue;
  readonly topCategory: RiskCategoryValue;
  /** All signals that fired, most-severe first. Persisted to the tamper-evident audit log. */
  readonly signals: readonly SafetySignal[];
  /** Localized hotline info to surface when `escalationPath === URGENT_HOTLINE`. */
  readonly hotline?: HotlineInfo;
}

export interface HotlineInfo {
  readonly region: 'IL' | 'US';
  readonly displayName: string;
  readonly phone: string;
}
