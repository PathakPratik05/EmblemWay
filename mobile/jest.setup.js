/* eslint-env jest */
/* Mocks for native modules that do not exist in the Jest (Node) environment. */
const { webcrypto } = require('crypto');

jest.mock('react-native-get-random-values', () => ({}));
if (!global.crypto) global.crypto = webcrypto;

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));

jest.mock('react-native-keychain', () => {
  let stored = null;
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    setGenericPassword: jest.fn(async (_u, password) => {
      stored = { username: 'emblemway', password };
      return true;
    }),
    getGenericPassword: jest.fn(async () => stored || false),
    resetGenericPassword: jest.fn(async () => {
      stored = null;
      return true;
    }),
  };
});

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mock = (name) => {
    const C = React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
      return React.createElement(View, { ...props, testID: props.testID || name }, props.children);
    });
    C.displayName = name;
    return C;
  };
  const MapView = mock('MapView');
  return { __esModule: true, default: MapView, Marker: mock('Marker'), Polyline: mock('Polyline'), Polygon: mock('Polygon'), Circle: mock('Circle'), PROVIDER_GOOGLE: 'google' };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name }) => React.createElement(Text, null, `icon:${name}`);
});

jest.mock('@react-native-community/geolocation', () => ({ getCurrentPosition: jest.fn() }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn(async () => ({ didCancel: true })) }));
jest.mock('@react-native-firebase/app', () => ({ getApp: jest.fn(() => { throw new Error('not configured'); }) }));
jest.mock('@react-native-firebase/messaging', () => ({ getMessaging: jest.fn(), getToken: jest.fn(), onTokenRefresh: jest.fn() }));
