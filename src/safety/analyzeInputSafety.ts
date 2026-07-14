/**
 * Layered AI Safety Guardrail — Pre-LLM Clinical Triage
 * =====================================================
 *
 * `validateTherapeuticInput` is the gate every patient free-text input passes through BEFORE
 * a generative model is invoked. It implements a two-system architecture:
 *
 *   System 1 (fast, lexical)      — deterministic regex/keyword matching. High precision on
 *                                   explicit crisis language; effectively zero latency.
 *   System 2 (deliberative, mock) — a *mocked* embedding-similarity classifier standing in for
 *                                   a real on-device model (e.g. an ONNX safety classifier).
 *                                   Catches paraphrased / implicit risk that lexical rules miss.
 *
 * The two layers are unioned; the highest-acuity signal decides the `escalationPath` via an
 * exhaustive switch (compile-time guarantee that every `RiskCategory` is handled). On any
 * crisis category the function returns `isSafe: false, requiresEscalation: true` so the caller
 * hard-stops generative processing and shows human/emergency resources.
 *
 * Psychosis follows the READI protocol: the path is de-escalation + human referral, never
 * confrontation or validation of the delusion.
 *
 * Privacy: rationales are non-identifying (category + layer), never the raw input, so the audit
 * log they feed cannot become a secondary PHI store.
 */
import {
  DetectionLayer,
  EscalationPath,
  RiskCategory,
  type EscalationPathValue,
  type HotlineInfo,
  type RiskCategoryValue,
  type SafetyReport,
  type SafetySignal,
} from './types';

export interface ValidateOptions {
  /** Region for hotline routing. Defaults to Israel. */
  readonly region: 'IL' | 'US';
  /**
   * System 2 confidence at/above which a classifier-only signal is trusted. Lexical (System 1)
   * matches always fire regardless of this threshold.
   */
  readonly classifierThreshold: number;
}

const DEFAULT_OPTIONS: ValidateOptions = {
  region: 'IL',
  classifierThreshold: 0.72,
};

const HOTLINES: Record<'IL' | 'US', HotlineInfo> = {
  IL: { region: 'IL', displayName: 'ERAN Emotional First Aid (Israel)', phone: '1201' },
  US: { region: 'US', displayName: '988 Suicide & Crisis Lifeline (US)', phone: '988' },
};

/**
 * Severity ordering (higher = more acute). Used to pick the decisive category when multiple
 * signals fire. Suicidal ideation and harm-to-others outrank everything.
 */
const SEVERITY_RANK: Record<RiskCategoryValue, number> = {
  [RiskCategory.NONE]: 0,
  [RiskCategory.PROMPT_INJECTION]: 1,
  [RiskCategory.SEVERE_PANIC]: 2,
  [RiskCategory.PSYCHOSIS]: 3,
  [RiskCategory.NSSI]: 4,
  [RiskCategory.HARM_TO_OTHERS]: 5,
  [RiskCategory.SUICIDAL_IDEATION]: 6,
};

/** System 1 lexical rules. Deliberately high-precision; recall is backstopped by System 2. */
const LEXICAL_RULES: ReadonlyArray<{ category: RiskCategoryValue; pattern: RegExp }> = [
  {
    category: RiskCategory.SUICIDAL_IDEATION,
    pattern:
      /\b(kill myself|end my life|suicid\w*|want to die|no reason to live|better off dead|take my own life)\b/i,
  },
  {
    category: RiskCategory.NSSI,
    pattern: /\b(cut myself|self[-\s]?harm|hurt myself|burn myself)\b/i,
  },
  {
    category: RiskCategory.HARM_TO_OTHERS,
    pattern: /\b(kill (him|her|them|everyone)|hurt (him|her|them)|make them pay|shoot up)\b/i,
  },
  {
    category: RiskCategory.PSYCHOSIS,
    pattern:
      /\b(they are watching me|voices? (are )?telling me|being controlled|implanted a chip|government is (spying|after me)|they can read my (thoughts|mind))\b/i,
  },
  {
    category: RiskCategory.SEVERE_PANIC,
    pattern: /\b(can'?t breathe|heart is racing|panic attack|going to die right now|chest is tight)\b/i,
  },
  {
    category: RiskCategory.PROMPT_INJECTION,
    pattern:
      /\b(ignore (your|previous|all) (instructions|rules)|you are now|pretend to be|disregard the (system|above)|jailbreak|act as an unrestricted)\b/i,
  },
];

/**
 * MOCK System 2 classifier. A real deployment swaps this for an on-device embedding model.
 * The mock is deterministic (no RNG) so unit tests are stable: it scores each category by
 * normalized signal-term density, simulating semantic similarity.
 */
const SEMANTIC_LEXICON: Record<RiskCategoryValue, readonly string[]> = {
  [RiskCategory.NONE]: [],
  [RiskCategory.SUICIDAL_IDEATION]: ['hopeless', 'worthless', 'burden', 'goodbye', 'give up', 'disappear'],
  [RiskCategory.NSSI]: ['blade', 'scars', 'punish myself', 'deserve pain'],
  [RiskCategory.HARM_TO_OTHERS]: ['revenge', 'weapon', 'make them suffer'],
  [RiskCategory.PSYCHOSIS]: ['conspiracy', 'signals', 'they know', 'not real', 'controlled', 'watched'],
  [RiskCategory.SEVERE_PANIC]: ['dizzy', 'trembling', 'suffocating', 'terror', 'losing control'],
  [RiskCategory.PROMPT_INJECTION]: ['system prompt', 'override', 'developer mode', 'bypass'],
};

async function classifySemantic(
  normalized: string,
  threshold: number,
): Promise<SafetySignal[]> {
  // Simulated async model call (in production: awaited inference on a bundled classifier).
  const tokenCount = Math.max(1, normalized.split(/\s+/).length);
  const signals: SafetySignal[] = [];

  for (const [category, terms] of Object.entries(SEMANTIC_LEXICON) as Array<
    [RiskCategoryValue, readonly string[]]
  >) {
    if (terms.length === 0) continue;
    const hits = terms.reduce((acc, term) => (normalized.includes(term) ? acc + 1 : acc), 0);
    if (hits === 0) continue;

    // Pseudo-similarity: saturating density score in [0, 1].
    const confidence = Math.min(1, 0.55 + hits / tokenCount + (hits - 1) * 0.1);
    if (confidence >= threshold) {
      signals.push({
        category,
        layer: DetectionLayer.SYSTEM_2_CLASSIFIER,
        confidence: Number(confidence.toFixed(2)),
        rationale: `Semantic classifier matched ${hits} risk term(s) for ${category}.`,
      });
    }
  }

  return signals;
}

function runLexical(normalized: string): SafetySignal[] {
  const signals: SafetySignal[] = [];
  for (const rule of LEXICAL_RULES) {
    if (rule.pattern.test(normalized)) {
      signals.push({
        category: rule.category,
        layer: DetectionLayer.SYSTEM_1_LEXICAL,
        confidence: 1,
        rationale: `Lexical rule matched for ${rule.category}.`,
      });
    }
  }
  return signals;
}

/**
 * Maps the decisive risk category to an escalation decision. Exhaustive `switch`: adding a new
 * `RiskCategory` without handling it here is a compile error (the `never` assertion).
 */
function decideEscalation(category: RiskCategoryValue): {
  isSafe: boolean;
  requiresEscalation: boolean;
  escalationPath: EscalationPathValue;
} {
  switch (category) {
    case RiskCategory.NONE:
      return { isSafe: true, requiresEscalation: false, escalationPath: EscalationPath.NONE };
    case RiskCategory.SUICIDAL_IDEATION:
    case RiskCategory.NSSI:
    case RiskCategory.HARM_TO_OTHERS:
      return {
        isSafe: false,
        requiresEscalation: true,
        escalationPath: EscalationPath.URGENT_HOTLINE,
      };
    case RiskCategory.PSYCHOSIS:
      // READI: de-escalate and offer human care; never confront or validate the delusion.
      return {
        isSafe: false,
        requiresEscalation: true,
        escalationPath: EscalationPath.READI_SUPPORT,
      };
    case RiskCategory.SEVERE_PANIC:
      // Not an emergency hand-off by default, but routed to a human clinician and blocked
      // from generative processing until supportive grounding content is shown.
      return {
        isSafe: false,
        requiresEscalation: true,
        escalationPath: EscalationPath.HUMAN_CLINICIAN,
      };
    case RiskCategory.PROMPT_INJECTION:
      return {
        isSafe: false,
        requiresEscalation: false,
        escalationPath: EscalationPath.REJECT_AND_REASSERT,
      };
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = category;
      throw new Error(`Unhandled risk category: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Validates a therapeutic free-text input against the layered guardrail. Always resolves
 * (never rejects); a thrown internal error is converted into a fail-safe escalation so a bug
 * in the classifier can never silently let dangerous text reach the LLM.
 */
export async function validateTherapeuticInput(
  text: string,
  options: Partial<ValidateOptions> = {},
): Promise<SafetyReport> {
  const { region, classifierThreshold } = { ...DEFAULT_OPTIONS, ...options };
  const normalized = text.toLowerCase().trim();

  try {
    if (normalized.length === 0) {
      return {
        isSafe: true,
        requiresEscalation: false,
        escalationPath: EscalationPath.NONE,
        topCategory: RiskCategory.NONE,
        signals: [],
      };
    }

    const lexicalSignals = runLexical(normalized);
    const semanticSignals = await classifySemantic(normalized, classifierThreshold);

    const signals = [...lexicalSignals, ...semanticSignals].sort(
      (a, b) => SEVERITY_RANK[b.category] - SEVERITY_RANK[a.category],
    );

    const topCategory = signals[0]?.category ?? RiskCategory.NONE;
    const decision = decideEscalation(topCategory);

    return {
      ...decision,
      topCategory,
      signals,
      ...(decision.escalationPath === EscalationPath.URGENT_HOTLINE
        ? { hotline: HOTLINES[region] }
        : {}),
    };
  } catch (error) {
    // Fail closed: any internal failure is treated as unsafe and escalated to a human.
    console.error('[safety] guardrail evaluation failed; failing closed', error);
    return {
      isSafe: false,
      requiresEscalation: true,
      escalationPath: EscalationPath.HUMAN_CLINICIAN,
      topCategory: RiskCategory.NONE,
      signals: [
        {
          category: RiskCategory.NONE,
          layer: DetectionLayer.SYSTEM_2_CLASSIFIER,
          confidence: 0,
          rationale: 'Guardrail internal error — failed closed.',
        },
      ],
    };
  }
}
