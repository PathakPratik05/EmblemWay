module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Inlines EMBLEMWAY_* environment variables at bundle time (e.g. EMBLEMWAY_API_URL).
    ['transform-inline-environment-variables', { include: ['EMBLEMWAY_API_URL'] }],
  ],
};
