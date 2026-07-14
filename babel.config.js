/**
 * Babel configuration.
 *
 * Two clinical-architecture concerns are wired here:
 *  1. WatermelonDB models rely on legacy decorators (`@field`, `@date`, `@json`).
 *     The `@babel/plugin-proposal-decorators` transform (legacy mode) is required
 *     for the decorated Model classes in `src/database/models/*` to compile.
 *  2. NativeWind's Babel preset enables Tailwind `className` props on RN primitives.
 *
 * `transform-remove-console` is applied only in production so that no PHI
 * (Protected Health Information) can leak through `console.*` in release builds —
 * a HIPAA / Amendment 13 data-minimization safeguard.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      ...(process.env.NODE_ENV === 'production'
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
    ],
  };
};
