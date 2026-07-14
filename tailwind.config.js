/**
 * Tailwind / NativeWind theme.
 *
 * The clinical palette is intentionally high-contrast (WCAG AA+) to satisfy the
 * accessibility requirement for the Thought Record flow. `crisis` tokens are used
 * exclusively by the AI-guardrail escalation UI so they remain visually distinct.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: '#0B1220',
        card: '#131C2E',
        primary: '#3B82F6',
        primaryText: '#F8FAFC',
        muted: '#94A3B8',
        success: '#16A34A',
        crisis: '#DC2626',
        crisisBg: '#450A0A',
      },
    },
  },
  plugins: [],
};
