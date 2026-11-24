module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['android/', 'coverage/', 'e2e/artifacts/'],
  rules: {
    // Promises in event handlers are intentionally fire-and-forget with `void`.
    'no-void': 'off',
    // Layout styles are colocated with the component markup by design.
    'react-native/no-inline-styles': 'off',
  },
  overrides: [
    {
      // Polyline decoding and UUID generation are inherently bitwise.
      files: ['src/utils/geo.ts', 'src/utils/ids.ts'],
      rules: { 'no-bitwise': 'off' },
    },
    {
      files: ['jest.setup.js', '__tests__/**', 'e2e/**'],
      env: { jest: true },
    },
  ],
};
