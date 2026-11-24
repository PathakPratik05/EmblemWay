import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { api } from '../../src/api';
import { ApiError } from '../../src/api/client';
import { useAuthStore } from '../../src/auth/authStore';
import { tokenStore } from '../../src/auth/tokenStorage';
import {
  OtpScreen,
  RegisterScreen,
  WelcomeScreen,
} from '../../src/screens/auth/AuthScreens';
import { me, renderScreen } from '../helpers';

jest.mock('../../src/api', () => ({
  setSessionExpiredHandler: jest.fn(),
  api: {
    auth: { requestOtp: jest.fn(), verifyOtp: jest.fn(), logout: jest.fn() },
    users: { me: jest.fn() },
  },
}));

const mocked = api as unknown as {
  auth: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  users: { me: jest.Mock };
};

const challenge = {
  requestId: '11111111-1111-4111-8111-111111111111',
  expiresAt: '',
  resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  codeLength: 6,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await tokenStore.clear();
  useAuthStore.setState({
    status: 'signedOut',
    user: null,
    needsProfileSetup: false,
    sessionExpiredNotice: false,
  });
});

describe('Login (Welcome) screen', () => {
  it('shows a validation error for an invalid number and does not call the API', async () => {
    renderScreen('Welcome', WelcomeScreen);
    fireEvent.changeText(await screen.findByTestId('login-mobile'), '12345');
    fireEvent.press(screen.getByTestId('login-submit'));
    expect(
      await screen.findByText('Enter a valid 10-digit Indian mobile number'),
    ).toBeTruthy();
    expect(mocked.auth.requestOtp).not.toHaveBeenCalled();
  });

  it('requests an OTP for a normalised number and opens the OTP screen', async () => {
    mocked.auth.requestOtp.mockResolvedValue(challenge);
    renderScreen('Welcome', WelcomeScreen, undefined, { Otp: OtpScreen });
    fireEvent.changeText(
      await screen.findByTestId('login-mobile'),
      '+91 98765-43210',
    );
    fireEvent.press(screen.getByTestId('login-submit'));
    await waitFor(() =>
      expect(mocked.auth.requestOtp).toHaveBeenCalledWith('9876543210'),
    );
    expect(await screen.findByTestId('otp-screen')).toBeTruthy();
  });

  it('shows server errors such as rate limiting', async () => {
    mocked.auth.requestOtp.mockRejectedValue(
      new ApiError(429, 'OTP_SEND_LIMIT', 'limit'),
    );
    renderScreen('Welcome', WelcomeScreen);
    fireEvent.changeText(
      await screen.findByTestId('login-mobile'),
      '9876543210',
    );
    fireEvent.press(screen.getByTestId('login-submit'));
    expect(
      await screen.findByText(
        'Too many codes requested. Try again in an hour.',
      ),
    ).toBeTruthy();
  });

  it('shows the session-expired notice', async () => {
    useAuthStore.setState({ sessionExpiredNotice: true });
    renderScreen('Welcome', WelcomeScreen);
    expect(await screen.findByTestId('session-expired')).toBeTruthy();
  });
});

describe('Registration screen', () => {
  it('validates required names', async () => {
    renderScreen('Register', RegisterScreen);
    fireEvent.press(await screen.findByTestId('register-submit'));
    expect(await screen.findByText('Enter your first name')).toBeTruthy();
    expect(screen.getByText('Enter your last name')).toBeTruthy();
    expect(mocked.auth.requestOtp).not.toHaveBeenCalled();
  });

  it('passes registration details to OTP verification', async () => {
    mocked.auth.requestOtp.mockResolvedValue(challenge);
    mocked.auth.verifyOtp.mockResolvedValue({
      tokens: {
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: '',
        refreshTokenExpiresAt: '',
        tokenType: 'Bearer',
      },
      user: { id: 'u1', firstName: 'Priya', lastName: 'K', role: 'USER' },
      isNewUser: true,
      profileComplete: false,
    });
    mocked.users.me.mockResolvedValue({ ...me, profileComplete: false });
    renderScreen('Register', RegisterScreen, undefined, { Otp: OtpScreen });
    fireEvent.changeText(
      await screen.findByTestId('register-firstName'),
      'Priya',
    );
    fireEvent.changeText(screen.getByTestId('register-lastName'), 'Kulkarni');
    fireEvent.changeText(
      screen.getByTestId('register-mobileNumber'),
      '9876543210',
    );
    fireEvent.press(screen.getByTestId('register-submit'));
    fireEvent.changeText(await screen.findByTestId('otp-code'), '123456');
    fireEvent.press(screen.getByTestId('otp-submit'));
    await waitFor(() =>
      expect(mocked.auth.verifyOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          code: '123456',
          firstName: 'Priya',
          lastName: 'Kulkarni',
        }),
      ),
    );
    await waitFor(() =>
      expect(useAuthStore.getState()).toMatchObject({
        status: 'signedIn',
        needsProfileSetup: true,
      }),
    );
    expect((await tokenStore.get())?.accessToken).toBe('a');
  });
});

describe('OTP screen', () => {
  const params = { ...challenge, mobileNumber: '9876543210' };

  it('requires exactly six digits and strips non-digits', async () => {
    renderScreen('Otp', OtpScreen, params);
    fireEvent.changeText(await screen.findByTestId('otp-code'), '12a3');
    fireEvent.press(screen.getByTestId('otp-submit'));
    expect(await screen.findByText('Enter the 6-digit code')).toBeTruthy();
    expect(mocked.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('shows remaining attempts for a wrong code', async () => {
    mocked.auth.verifyOtp.mockRejectedValue(
      new ApiError(400, 'OTP_INVALID', 'bad', { remainingAttempts: 3 }),
    );
    renderScreen('Otp', OtpScreen, params);
    fireEvent.changeText(await screen.findByTestId('otp-code'), '000000');
    fireEvent.press(screen.getByTestId('otp-submit'));
    expect(
      await screen.findByText('That code is incorrect. 3 attempts left.'),
    ).toBeTruthy();
  });

  it('disables resend during the cooldown, then allows it', async () => {
    jest.useFakeTimers();
    mocked.auth.requestOtp.mockResolvedValue({
      ...challenge,
      requestId: '22222222-2222-4222-8222-222222222222',
    });
    renderScreen('Otp', OtpScreen, {
      ...params,
      resendAvailableAt: new Date(Date.now() + 3000).toISOString(),
    });
    expect(await screen.findByText(/Resend code in \ds/)).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(await screen.findByText('Resend code')).toBeTruthy();
    jest.useRealTimers();
    fireEvent.press(screen.getByTestId('otp-resend'));
    await waitFor(() =>
      expect(mocked.auth.requestOtp).toHaveBeenCalledWith('9876543210'),
    );
  });
});

describe('auth store', () => {
  it('bootstrap: no stored token -> signed out', async () => {
    await act(() => useAuthStore.getState().bootstrap());
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('bootstrap: valid token -> signed in with profile', async () => {
    await tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: '',
      refreshTokenExpiresAt: '',
      tokenType: 'Bearer',
    });
    mocked.users.me.mockResolvedValue(me);
    await act(() => useAuthStore.getState().bootstrap());
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedIn',
      user: { firstName: 'Priya' },
      needsProfileSetup: false,
    });
  });

  it('bootstrap: offline keeps the session', async () => {
    await tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: '',
      refreshTokenExpiresAt: '',
      tokenType: 'Bearer',
    });
    mocked.users.me.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'offline'),
    );
    await act(() => useAuthStore.getState().bootstrap());
    expect(useAuthStore.getState().status).toBe('signedIn');
    expect(await tokenStore.get()).not.toBeNull();
  });

  it('bootstrap: rejected session (deleted user) -> signed out and tokens cleared', async () => {
    await tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: '',
      refreshTokenExpiresAt: '',
      tokenType: 'Bearer',
    });
    mocked.users.me.mockRejectedValue(
      new ApiError(401, 'ACCOUNT_DELETED', 'deleted'),
    );
    await act(() => useAuthStore.getState().bootstrap());
    expect(useAuthStore.getState().status).toBe('signedOut');
    expect(await tokenStore.get()).toBeNull();
  });

  it('signOut clears tokens even when the server is unreachable', async () => {
    await tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: '',
      refreshTokenExpiresAt: '',
      tokenType: 'Bearer',
    });
    (api.auth as unknown as { logout: jest.Mock }).logout.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'x'),
    );
    useAuthStore.setState({ status: 'signedIn', user: me });
    await act(() => useAuthStore.getState().signOut());
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedOut',
      user: null,
    });
    expect(await tokenStore.get()).toBeNull();
  });
});
