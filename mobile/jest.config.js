module.exports = {
  preset: 'react-native',
  // EmblemWay is an Android app: resolve *.android.js and Platform.OS === 'android' in tests.
  haste: { defaultPlatform: 'android', platforms: ['android', 'ios', 'native'] },
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/android/', '__tests__/helpers'],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|react-native-.*|@react-native-community|@react-native-firebase|@tanstack|zustand|@hookform)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/navigation/types.ts',
    '!src/api/types.ts',
    '!src/theme/**',
  ],
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
};
