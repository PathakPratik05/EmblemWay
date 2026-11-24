/** Inlined at bundle time by babel-plugin-transform-inline-environment-variables. */
declare const process: {
  env: { EMBLEMWAY_API_URL?: string; NODE_ENV?: string };
};

/** Provided by react-native-get-random-values (CSPRNG backed by the platform). */
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};
