/**
 * Thought Record Protocol Machine (XState v5)
 * ===========================================
 *
 * Encodes the CBT ABC-model intake as a *deterministic* finite-state machine, decoupling the
 * clinical protocol from the UI. Clinicians and engineers can reason about (and visualize in
 * Stately) the exact set of legal transitions, and guards make clinically-invalid moves
 * structurally impossible rather than relying on ad-hoc UI checks.
 *
 * Flow:
 *   idle → analyzing_situation → identifying_emotions → catching_automatic_thoughts
 *        → tagging_distortions → restructuring_thought → saving_to_db → completed
 *   saving_to_db --(onError)--> error --(RETRY, bounded)--> saving_to_db
 *
 * Guards (clinical validity):
 *   - a situation must be described before naming emotions
 *   - an emotion + 0–100 intensity is required before eliciting the automatic thought
 *   - the automatic thought must be a real sentence (≥ 3 words) — prevents empty submissions
 *   - at least one distortion must be tagged before restructuring, UNLESS the patient
 *     explicitly bypasses (some genuine thoughts fit no distortion; forcing one is iatrogenic)
 *
 * The `saving_to_db` state invokes an async actor that writes through the repository to the
 * encrypted WatermelonDB store, with bounded local retry on failure (offline-resilient).
 */
import { assign, fromPromise, setup } from 'xstate';

import { createThoughtRecord } from '../database/repositories/thoughtRecordRepository';
import {
  EMPTY_THOUGHT_RECORD_DRAFT,
  type CognitiveDistortionValue,
  type PersistableThoughtRecord,
  type ThoughtRecordDraft,
} from '../domain/thoughtRecord';

/** Maximum automatic-retry attempts for the DB write before surfacing a hard failure. */
const MAX_SAVE_RETRIES = 3;

/** Minimum word count that qualifies an automatic thought as substantive. */
const MIN_AUTOMATIC_THOUGHT_WORDS = 3;

export interface ThoughtRecordContext {
  /** Owning patient (WatermelonDB local id). Set on START. */
  userId: string;
  /** The record being assembled step-by-step. */
  draft: ThoughtRecordDraft;
  /** Number of save attempts already made in the current error-recovery cycle. */
  retryCount: number;
  /** Human-readable failure reason, shown in the `error` state. */
  errorMessage: string | null;
  /** Local id of the persisted record, available in `completed`. */
  savedRecordId: string | null;
}

export type ThoughtRecordEvent =
  | { type: 'START'; userId: string }
  | { type: 'SET_SITUATION'; situation: string }
  | { type: 'SET_EMOTION'; emotion: string; emotionIntensity: number }
  | { type: 'SET_AUTOMATIC_THOUGHT'; automaticThought: string }
  | { type: 'TOGGLE_DISTORTION'; distortion: CognitiveDistortionValue }
  | { type: 'SET_BALANCED_THOUGHT'; balancedThought: string }
  | { type: 'NEXT_STEP'; bypassDistortions?: boolean }
  | { type: 'BACK' }
  | { type: 'RETRY' }
  | { type: 'RESET' };

/** Input required to instantiate the machine. */
export interface ThoughtRecordInput {
  userId: string;
}

/** Input the save actor needs to persist the assembled draft. */
type SaveActorInput = { draft: ThoughtRecordDraft; userId: string };

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export const thoughtRecordMachine = setup({
  types: {
    context: {} as ThoughtRecordContext,
    events: {} as ThoughtRecordEvent,
    input: {} as ThoughtRecordInput,
  },
  actors: {
    /**
     * Async DB write. Isolated as an actor so the machine stays synchronous and the side
     * effect is observable/interruptible. Delegates to the repository (single writer).
     */
    saveThoughtRecord: fromPromise<string, SaveActorInput>(async ({ input }) => {
      const persistable: PersistableThoughtRecord = {
        userId: input.userId,
        situation: input.draft.situation,
        emotion: input.draft.emotion,
        emotionIntensity: input.draft.emotionIntensity,
        automaticThought: input.draft.automaticThought,
        distortionTags: input.draft.distortionTags,
        balancedThought: input.draft.balancedThought,
      };
      const saved = await createThoughtRecord(persistable, new Date());
      return saved.id;
    }),
  },
  guards: {
    hasSituation: ({ context }) => context.draft.situation.trim().length > 0,
    hasEmotion: ({ context }) => {
      const { emotion, emotionIntensity } = context.draft;
      return emotion.trim().length > 0 && emotionIntensity >= 0 && emotionIntensity <= 100;
    },
    hasSubstantiveThought: ({ context }) =>
      countWords(context.draft.automaticThought) >= MIN_AUTOMATIC_THOUGHT_WORDS,
    /** At least one distortion tagged, OR the patient explicitly bypassed this gate. */
    hasDistortionsOrBypass: ({ context, event }) =>
      context.draft.distortionTags.length > 0 ||
      (event.type === 'NEXT_STEP' && event.bypassDistortions === true),
    canRetry: ({ context }) => context.retryCount < MAX_SAVE_RETRIES,
  },
  actions: {
    assignSituation: assign(({ context, event }) => {
      if (event.type !== 'SET_SITUATION') return {};
      return { draft: { ...context.draft, situation: event.situation } };
    }),
    assignEmotion: assign(({ context, event }) => {
      if (event.type !== 'SET_EMOTION') return {};
      return {
        draft: {
          ...context.draft,
          emotion: event.emotion,
          emotionIntensity: event.emotionIntensity,
        },
      };
    }),
    assignAutomaticThought: assign(({ context, event }) => {
      if (event.type !== 'SET_AUTOMATIC_THOUGHT') return {};
      return { draft: { ...context.draft, automaticThought: event.automaticThought } };
    }),
    toggleDistortion: assign(({ context, event }) => {
      if (event.type !== 'TOGGLE_DISTORTION') return {};
      const current = context.draft.distortionTags;
      const next = current.includes(event.distortion)
        ? current.filter((tag) => tag !== event.distortion)
        : [...current, event.distortion];
      return { draft: { ...context.draft, distortionTags: next } };
    }),
    assignBalancedThought: assign(({ context, event }) => {
      if (event.type !== 'SET_BALANCED_THOUGHT') return {};
      return { draft: { ...context.draft, balancedThought: event.balancedThought } };
    }),
    incrementRetry: assign(({ context }) => ({ retryCount: context.retryCount + 1 })),
    recordError: assign(({ event }) => {
      const reason =
        'error' in event && event.error instanceof Error
          ? event.error.message
          : 'Unknown persistence error';
      return { errorMessage: reason };
    }),
    clearError: assign({ errorMessage: null }),
    assignSavedId: assign(({ event }) => {
      // `event.output` is the actor's resolved value (the saved record id).
      if ('output' in event && typeof event.output === 'string') {
        return { savedRecordId: event.output };
      }
      return {};
    }),
    resetDraft: assign(({ context }) => ({
      draft: { ...EMPTY_THOUGHT_RECORD_DRAFT, distortionTags: [] },
      retryCount: 0,
      errorMessage: null,
      savedRecordId: null,
      userId: context.userId,
    })),
  },
}).createMachine({
  id: 'thoughtRecord',
  initial: 'idle',
  context: ({ input }) => ({
    userId: input.userId,
    draft: { ...EMPTY_THOUGHT_RECORD_DRAFT, distortionTags: [] },
    retryCount: 0,
    errorMessage: null,
    savedRecordId: null,
  }),
  states: {
    idle: {
      on: {
        START: {
          target: 'analyzing_situation',
          actions: assign(({ event }) => ({ userId: event.userId })),
        },
      },
    },

    analyzing_situation: {
      on: {
        SET_SITUATION: { actions: 'assignSituation' },
        NEXT_STEP: { target: 'identifying_emotions', guard: 'hasSituation' },
      },
    },

    identifying_emotions: {
      on: {
        SET_EMOTION: { actions: 'assignEmotion' },
        BACK: { target: 'analyzing_situation' },
        NEXT_STEP: { target: 'catching_automatic_thoughts', guard: 'hasEmotion' },
      },
    },

    catching_automatic_thoughts: {
      on: {
        SET_AUTOMATIC_THOUGHT: { actions: 'assignAutomaticThought' },
        BACK: { target: 'identifying_emotions' },
        NEXT_STEP: { target: 'tagging_distortions', guard: 'hasSubstantiveThought' },
      },
    },

    tagging_distortions: {
      on: {
        TOGGLE_DISTORTION: { actions: 'toggleDistortion' },
        BACK: { target: 'catching_automatic_thoughts' },
        NEXT_STEP: { target: 'restructuring_thought', guard: 'hasDistortionsOrBypass' },
      },
    },

    restructuring_thought: {
      on: {
        SET_BALANCED_THOUGHT: { actions: 'assignBalancedThought' },
        BACK: { target: 'tagging_distortions' },
        // No content guard: a balanced thought may legitimately be brief. Advancing here
        // commits the record to the encrypted store.
        NEXT_STEP: { target: 'saving_to_db' },
      },
    },

    saving_to_db: {
      entry: 'clearError',
      invoke: {
        src: 'saveThoughtRecord',
        input: ({ context }) => ({ draft: context.draft, userId: context.userId }),
        onDone: { target: 'completed', actions: 'assignSavedId' },
        onError: { target: 'error', actions: 'recordError' },
      },
    },

    error: {
      on: {
        RETRY: {
          target: 'saving_to_db',
          guard: 'canRetry',
          actions: 'incrementRetry',
        },
        BACK: { target: 'restructuring_thought', actions: 'clearError' },
      },
    },

    // Terminal-but-restartable: the record is committed, yet the patient can begin a fresh
    // one without tearing down the actor. (Not `type: 'final'`, which would forbid RESET.)
    completed: {
      on: {
        RESET: { target: 'analyzing_situation', actions: 'resetDraft' },
      },
    },
  },
});

export type ThoughtRecordMachine = typeof thoughtRecordMachine;
