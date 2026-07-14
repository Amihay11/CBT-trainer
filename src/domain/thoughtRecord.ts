/**
 * Domain types for the CBT Thought Record (ABC model).
 *
 * Shared by the XState protocol machine (which assembles the draft step-by-step) and the
 * persistence repository (which writes it). Keeping the shape here — not inside either
 * consumer — prevents a circular dependency and gives us one authoritative contract.
 */

/**
 * Canonical set of cognitive distortions the patient can tag. Modeled as a const object so
 * the UI can enumerate labels while the values stay stable identifiers safe to persist.
 */
export const CognitiveDistortion = {
  ALL_OR_NOTHING: 'all_or_nothing',
  OVERGENERALIZATION: 'overgeneralization',
  MIND_READING: 'mind_reading',
  CATASTROPHIZING: 'catastrophizing',
  EMOTIONAL_REASONING: 'emotional_reasoning',
  SHOULD_STATEMENTS: 'should_statements',
  LABELING: 'labeling',
  PERSONALIZATION: 'personalization',
  MENTAL_FILTER: 'mental_filter',
  DISCOUNTING_POSITIVE: 'discounting_positive',
} as const;

export type CognitiveDistortionValue =
  (typeof CognitiveDistortion)[keyof typeof CognitiveDistortion];

/** Human-readable labels for rendering the distortion picker. */
export const DISTORTION_LABELS: Record<CognitiveDistortionValue, string> = {
  [CognitiveDistortion.ALL_OR_NOTHING]: 'All-or-Nothing Thinking',
  [CognitiveDistortion.OVERGENERALIZATION]: 'Overgeneralization',
  [CognitiveDistortion.MIND_READING]: 'Mind Reading',
  [CognitiveDistortion.CATASTROPHIZING]: 'Catastrophizing',
  [CognitiveDistortion.EMOTIONAL_REASONING]: 'Emotional Reasoning',
  [CognitiveDistortion.SHOULD_STATEMENTS]: 'Should Statements',
  [CognitiveDistortion.LABELING]: 'Labeling',
  [CognitiveDistortion.PERSONALIZATION]: 'Personalization',
  [CognitiveDistortion.MENTAL_FILTER]: 'Mental Filter',
  [CognitiveDistortion.DISCOUNTING_POSITIVE]: 'Discounting the Positive',
};

/**
 * The in-progress draft accumulated as the patient advances through the protocol. Fields are
 * optional until their step is completed; a guard enforces required fields before each
 * transition (see `thoughtRecordMachine`).
 */
export interface ThoughtRecordDraft {
  situation: string;
  emotion: string;
  /** SUDS-style 0–100 subjective intensity captured before restructuring. */
  emotionIntensity: number;
  automaticThought: string;
  distortionTags: CognitiveDistortionValue[];
  balancedThought: string;
}

/** A validated, ready-to-persist record (all required fields present). */
export type PersistableThoughtRecord = Required<
  Pick<
    ThoughtRecordDraft,
    'situation' | 'emotion' | 'emotionIntensity' | 'automaticThought' | 'distortionTags'
  >
> &
  Pick<ThoughtRecordDraft, 'balancedThought'> & {
    /** Owning patient id (WatermelonDB local id of the `users` row). */
    userId: string;
  };

/** An empty draft used to seed the machine's initial context. */
export const EMPTY_THOUGHT_RECORD_DRAFT: ThoughtRecordDraft = {
  situation: '',
  emotion: '',
  emotionIntensity: 0,
  automaticThought: '',
  distortionTags: [],
  balancedThought: '',
};
