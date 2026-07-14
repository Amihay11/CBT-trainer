/**
 * Metro bundler configuration.
 *
 * NativeWind requires wrapping the Expo Metro config so that Tailwind's
 * generated CSS is injected into the RN bundle. The global stylesheet path
 * (`./global.css`) hosts the Tailwind directives consumed at build time.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
