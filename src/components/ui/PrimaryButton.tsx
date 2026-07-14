/**
 * PrimaryButton — accessible, theme-aware action button.
 *
 * Encapsulates the accessibility contract (role, disabled state, min touch target) so every
 * call site is compliant by construction rather than by remembering to add a11y props.
 */
import { ActivityIndicator, Pressable, Text } from 'react-native';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Visual emphasis. `danger` is reserved for destructive/crisis actions. */
  variant?: 'primary' | 'secondary' | 'danger';
  accessibilityHint?: string;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  accessibilityHint,
}: PrimaryButtonProps) {
  const isInteractive = !disabled && !loading;

  const background =
    variant === 'primary'
      ? 'bg-primary'
      : variant === 'danger'
        ? 'bg-crisis'
        : 'bg-card border border-muted';

  return (
    <Pressable
      onPress={isInteractive ? onPress : undefined}
      disabled={!isInteractive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !isInteractive, busy: loading }}
      // 48dp minimum target satisfies WCAG 2.5.5 / platform a11y guidance.
      className={`min-h-[48px] flex-row items-center justify-center rounded-2xl px-6 py-3 ${background} ${
        isInteractive ? 'opacity-100' : 'opacity-50'
      }`}
    >
      {loading ? (
        <ActivityIndicator color="#F8FAFC" />
      ) : (
        <Text className="text-base font-semibold text-primaryText">{label}</Text>
      )}
    </Pressable>
  );
}
