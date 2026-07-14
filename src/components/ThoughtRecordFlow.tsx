/**
 * ThoughtRecordFlow — declarative UI driven by the XState protocol machine.
 *
 * The component holds NO protocol logic: it renders whatever step the machine is in and sends
 * events. This is the payoff of the FSM design — the screen is a pure projection of machine
 * state, so a clinician changing the protocol (in the machine) changes the UX with zero risk
 * of the two drifting out of sync.
 *
 * Two cross-cutting concerns are wired here:
 *   1. Safety gating — before advancing past a free-text step, the input is run through the
 *      pre-LLM guardrail (`validateTherapeuticInput`). A crisis flag replaces the flow with the
 *      escalation screen instead of sending NEXT_STEP.
 *   2. Accessibility — every interactive element carries labels/roles/state and adequate
 *      contrast (see `tailwind.config.js` palette).
 */
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useMachine } from '@xstate/react';

import {
  CognitiveDistortion,
  DISTORTION_LABELS,
  type CognitiveDistortionValue,
} from '../domain/thoughtRecord';
import { thoughtRecordMachine } from '../machines/thoughtRecordMachine';
import { validateTherapeuticInput } from '../safety/analyzeInputSafety';
import type { SafetyReport } from '../safety/types';
import { CrisisEscalation } from './CrisisEscalation';
import { PrimaryButton } from './ui/PrimaryButton';

/** Flat state names of the machine — kept in sync for the exhaustive render switch. */
type StepName =
  | 'idle'
  | 'analyzing_situation'
  | 'identifying_emotions'
  | 'catching_automatic_thoughts'
  | 'tagging_distortions'
  | 'restructuring_thought'
  | 'saving_to_db'
  | 'completed'
  | 'error';

const INTENSITY_PRESETS = [0, 25, 50, 75, 100] as const;

export interface ThoughtRecordFlowProps {
  /** Owning patient (local WatermelonDB user id). */
  userId: string;
  /** Called once a record is committed, e.g. to navigate to the insights dashboard. */
  onCompleted?: (recordId: string) => void;
}

export function ThoughtRecordFlow({ userId, onCompleted }: ThoughtRecordFlowProps) {
  const [state, send] = useMachine(thoughtRecordMachine, { input: { userId } });
  const [crisisReport, setCrisisReport] = useState<SafetyReport | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const draft = state.context.draft;
  const savedRecordId = state.context.savedRecordId;
  const isCompleted = state.matches('completed');

  // Notify the host once, when the record is committed — a side effect belongs in an effect,
  // never in render.
  useEffect(() => {
    if (isCompleted && savedRecordId && onCompleted) {
      onCompleted(savedRecordId);
    }
  }, [isCompleted, savedRecordId, onCompleted]);

  /** Runs the safety guardrail on free-text before advancing; blocks on a crisis flag. */
  async function guardedAdvance(text: string, bypassDistortions = false): Promise<void> {
    setIsChecking(true);
    try {
      const report = await validateTherapeuticInput(text, { region: 'IL' });
      if (!report.isSafe) {
        setCrisisReport(report);
        return;
      }
      send({ type: 'NEXT_STEP', bypassDistortions });
    } finally {
      setIsChecking(false);
    }
  }

  if (crisisReport) {
    return <CrisisEscalation report={crisisReport} onDismiss={() => setCrisisReport(null)} />;
  }

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName="gap-6 p-6"
      keyboardShouldPersistTaps="handled"
    >
      {renderStep()}
    </ScrollView>
  );

  function renderStep() {
    const step = String(state.value) as StepName;
    switch (step) {
      case 'idle':
        return (
          <StepShell title="Thought Record" subtitle="A guided CBT exercise to reframe a difficult moment.">
            <PrimaryButton
              label="Begin"
              onPress={() => send({ type: 'START', userId })}
              accessibilityHint="Starts the thought record."
            />
          </StepShell>
        );

      case 'analyzing_situation':
        return (
          <StepShell title="1. The Situation" subtitle="What happened? Describe the moment factually.">
            <LabeledInput
              label="Situation"
              value={draft.situation}
              onChangeText={(situation) => send({ type: 'SET_SITUATION', situation })}
              placeholder="e.g. My manager didn't reply to my message all day."
              multiline
            />
            <Footer
              onNext={() => void guardedAdvance(draft.situation)}
              nextDisabled={draft.situation.trim().length === 0}
              nextLoading={isChecking}
            />
          </StepShell>
        );

      case 'identifying_emotions':
        return (
          <StepShell title="2. Emotions" subtitle="Name the strongest feeling and rate its intensity.">
            <LabeledInput
              label="Emotion"
              value={draft.emotion}
              onChangeText={(emotion) =>
                send({ type: 'SET_EMOTION', emotion, emotionIntensity: draft.emotionIntensity })
              }
              placeholder="e.g. Anxious"
            />
            <Text className="text-sm text-muted">Intensity: {draft.emotionIntensity}%</Text>
            <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
              {INTENSITY_PRESETS.map((preset) => {
                const selected = draft.emotionIntensity === preset;
                return (
                  <Chip
                    key={preset}
                    label={`${preset}%`}
                    selected={selected}
                    onPress={() =>
                      send({ type: 'SET_EMOTION', emotion: draft.emotion, emotionIntensity: preset })
                    }
                  />
                );
              })}
            </View>
            <Footer
              onBack={() => send({ type: 'BACK' })}
              onNext={() => send({ type: 'NEXT_STEP' })}
              nextDisabled={draft.emotion.trim().length === 0}
            />
          </StepShell>
        );

      case 'catching_automatic_thoughts':
        return (
          <StepShell
            title="3. Automatic Thought"
            subtitle="What went through your mind? Write at least a full sentence."
          >
            <LabeledInput
              label="Automatic thought"
              value={draft.automaticThought}
              onChangeText={(automaticThought) =>
                send({ type: 'SET_AUTOMATIC_THOUGHT', automaticThought })
              }
              placeholder="e.g. He's ignoring me because I did something wrong."
              multiline
            />
            <Footer
              onBack={() => send({ type: 'BACK' })}
              onNext={() => void guardedAdvance(draft.automaticThought)}
              nextDisabled={draft.automaticThought.trim().split(/\s+/).filter(Boolean).length < 3}
              nextLoading={isChecking}
            />
          </StepShell>
        );

      case 'tagging_distortions':
        return (
          <StepShell
            title="4. Cognitive Distortions"
            subtitle="Which thinking traps might be at play? Select any that fit."
          >
            <View className="gap-2">
              {(Object.keys(DISTORTION_LABELS) as CognitiveDistortionValue[]).map((distortion) => {
                const selected = draft.distortionTags.includes(distortion);
                return (
                  <Chip
                    key={distortion}
                    label={DISTORTION_LABELS[distortion]}
                    selected={selected}
                    fullWidth
                    onPress={() => send({ type: 'TOGGLE_DISTORTION', distortion })}
                  />
                );
              })}
            </View>
            <Footer
              onBack={() => send({ type: 'BACK' })}
              onNext={() => send({ type: 'NEXT_STEP' })}
              nextLabel={draft.distortionTags.length === 0 ? 'Skip — none apply' : 'Next'}
              // Skipping is a legitimate clinical choice; pass the bypass flag through the guard.
              onNextAlt={
                draft.distortionTags.length === 0
                  ? () => send({ type: 'NEXT_STEP', bypassDistortions: true })
                  : undefined
              }
            />
          </StepShell>
        );

      case 'restructuring_thought':
        return (
          <StepShell
            title="5. Balanced Thought"
            subtitle="Given the evidence, what's a fairer, more balanced way to see this?"
          >
            <LabeledInput
              label="Balanced thought"
              value={draft.balancedThought}
              onChangeText={(balancedThought) =>
                send({ type: 'SET_BALANCED_THOUGHT', balancedThought })
              }
              placeholder="e.g. He's likely just busy; his silence isn't proof I did something wrong."
              multiline
            />
            <Footer
              onBack={() => send({ type: 'BACK' })}
              onNext={() => void guardedAdvance(draft.balancedThought)}
              nextLabel="Save record"
              nextLoading={isChecking}
            />
          </StepShell>
        );

      case 'saving_to_db':
        return (
          <StepShell title="Saving…" subtitle="Encrypting and storing your record securely on this device.">
            <PrimaryButton label="Saving…" onPress={() => undefined} loading disabled />
          </StepShell>
        );

      case 'error':
        return (
          <StepShell
            title="Couldn't save"
            subtitle={state.context.errorMessage ?? 'Something went wrong while saving.'}
          >
            <Footer
              onBack={() => send({ type: 'BACK' })}
              onNext={() => send({ type: 'RETRY' })}
              nextLabel="Try again"
            />
          </StepShell>
        );

      case 'completed':
        return (
          <StepShell title="Nicely done" subtitle="Your thought record is saved. Reframing takes practice.">
            <PrimaryButton
              label="New record"
              onPress={() => send({ type: 'RESET' })}
              accessibilityHint="Starts a fresh thought record."
            />
          </StepShell>
        );

      default: {
        const _exhaustive: never = step;
        throw new Error(`Unhandled step: ${String(_exhaustive)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Presentational primitives
// ---------------------------------------------------------------------------------------------

function StepShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-2xl font-bold text-primaryText">
          {title}
        </Text>
        <Text className="text-base text-muted">{subtitle}</Text>
      </View>
      {children}
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#64748B"
        multiline={multiline}
        accessibilityLabel={label}
        className={`rounded-2xl bg-card px-4 py-3 text-base text-primaryText ${
          multiline ? 'min-h-[96px]' : ''
        }`}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  fullWidth = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  fullWidth?: boolean;
}) {
  return (
    <Text
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      className={`rounded-full px-4 py-2 text-sm ${fullWidth ? 'w-full' : ''} ${
        selected ? 'bg-primary text-primaryText' : 'bg-card text-muted'
      }`}
    >
      {selected ? '✓ ' : ''}
      {label}
    </Text>
  );
}

function Footer({
  onNext,
  onBack,
  nextLabel = 'Next',
  nextDisabled = false,
  nextLoading = false,
  onNextAlt,
}: {
  onNext: () => void;
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  /** When set, overrides the primary press (used for the "skip distortions" path). */
  onNextAlt?: () => void;
}) {
  return (
    <View className="mt-2 flex-row gap-3">
      {onBack ? (
        <View className="flex-1">
          <PrimaryButton label="Back" onPress={onBack} variant="secondary" />
        </View>
      ) : null}
      <View className="flex-[2]">
        <PrimaryButton
          label={nextLabel}
          onPress={onNextAlt ?? onNext}
          disabled={nextDisabled}
          loading={nextLoading}
        />
      </View>
    </View>
  );
}
