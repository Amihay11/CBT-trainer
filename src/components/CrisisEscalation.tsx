/**
 * CrisisEscalation — the hard-stop UI rendered when the safety guardrail flags an input.
 *
 * This screen replaces the therapeutic flow (Gating): the LLM is never invoked, and the patient
 * is routed to appropriate human/emergency support based on the `SafetyReport`. Copy is
 * deliberately calm, non-judgmental, and READI-aligned for the psychosis path (no confrontation
 * or validation of delusional content).
 */
import { Linking, Text, View } from 'react-native';

import { EscalationPath, type SafetyReport } from '../safety/types';
import { PrimaryButton } from './ui/PrimaryButton';

export interface CrisisEscalationProps {
  report: SafetyReport;
  /** Return the patient to safety (e.g. dismiss and offer grounding exercises). */
  onDismiss: () => void;
}

interface EscalationCopy {
  title: string;
  body: string;
  primaryLabel?: string;
  primaryAction?: () => void;
}

export function CrisisEscalation({ report, onDismiss }: CrisisEscalationProps) {
  const copy = buildCopy(report);

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={copy.title}
      className="flex-1 justify-center gap-6 bg-crisisBg p-6"
    >
      <Text className="text-2xl font-bold text-primaryText">{copy.title}</Text>
      <Text className="text-base leading-6 text-primaryText">{copy.body}</Text>

      {copy.primaryLabel && copy.primaryAction ? (
        <PrimaryButton
          label={copy.primaryLabel}
          onPress={copy.primaryAction}
          variant="danger"
          accessibilityHint="Opens your phone dialer to contact a crisis line."
        />
      ) : null}

      <PrimaryButton
        label="Not now — take me back"
        onPress={onDismiss}
        variant="secondary"
        accessibilityHint="Returns to a calming grounding exercise."
      />
    </View>
  );
}

/** Derives user-facing copy + action from the escalation decision. Exhaustive over the paths. */
function buildCopy(report: SafetyReport): EscalationCopy {
  switch (report.escalationPath) {
    case EscalationPath.URGENT_HOTLINE: {
      const phone = report.hotline?.phone ?? '1201';
      const name = report.hotline?.displayName ?? 'a crisis helpline';
      return {
        title: 'You deserve support right now',
        body: `It sounds like you're going through something really painful. You don't have to handle this alone — trained people at ${name} are available and want to help.`,
        primaryLabel: `Call ${phone}`,
        primaryAction: () => {
          void Linking.openURL(`tel:${phone}`);
        },
      };
    }
    case EscalationPath.READI_SUPPORT:
      // READI: acknowledge distress without labeling it an illness or engaging the content.
      return {
        title: "Let's slow down together",
        body: 'What you\'re experiencing sounds distressing. It can help to talk this through with a person you trust or a clinician. Would you like to connect with human support?',
        primaryLabel: 'Connect me with a clinician',
        primaryAction: onDismissToClinician,
      };
    case EscalationPath.HUMAN_CLINICIAN:
      return {
        title: "Let's take a breath",
        body: 'It looks like things feel intense right now. Before we continue, a grounding exercise or a message to your care team may help.',
        primaryLabel: 'Message my care team',
        primaryAction: onDismissToClinician,
      };
    case EscalationPath.REJECT_AND_REASSERT:
      return {
        title: 'I can only help within safe limits',
        body: 'This app provides CBT self-help tools and cannot act outside its clinical guardrails or provide medical diagnoses. Let\'s get back to your thought record.',
      };
    case EscalationPath.NONE:
      return {
        title: 'You\'re all set',
        body: 'No safety concerns were detected.',
      };
    default: {
      const _exhaustive: never = report.escalationPath;
      throw new Error(`Unhandled escalation path: ${String(_exhaustive)}`);
    }
  }
}

// Placeholder hand-off; a real app routes into its supported care model / messaging surface.
function onDismissToClinician(): void {
  // Intentionally minimal — wired by the host navigator in a full build.
}
