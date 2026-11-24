import { create } from 'zustand';
import { api, setSessionExpiredHandler } from '../api';
import { ApiError } from '../api/client';
import type { AuthResult, Me } from '../api/types';
import { queryClient } from '../hooks/queryClient';
import { tokenStore } from './tokenStorage';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  user: Me | null;
  /** True after OTP verification for a brand new account, until profile setup completes. */
  needsProfileSetup: boolean;
  sessionExpiredNotice: boolean;
  bootstrap: () => Promise<void>;
  completeLogin: (result: AuthResult) => Promise<void>;
  setUser: (user: Me) => void;
  signOut: (opts?: { remote?: boolean; expired?: boolean }) => Promise<void>;
  dismissSessionNotice: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  needsProfileSetup: false,
  sessionExpiredNotice: false,

  /** App start: restore the session from secure storage and validate it with the server. */
  bootstrap: async () => {
    const tokens = await tokenStore.get();
    if (!tokens) {
      set({ status: 'signedOut', user: null });
      return;
    }
    try {
      const me = await api.users.me();
      set({
        status: 'signedIn',
        user: me,
        needsProfileSetup: !me.profileComplete,
      });
    } catch (err) {
      if (err instanceof ApiError && err.isNetworkError) {
        // Offline at launch: keep the session; screens show offline states and retry.
        set({ status: 'signedIn', user: null, needsProfileSetup: false });
        return;
      }
      await tokenStore.clear();
      set({ status: 'signedOut', user: null });
    }
  },

  completeLogin: async result => {
    await tokenStore.set(result.tokens);
    set({
      status: 'signedIn',
      needsProfileSetup: !result.profileComplete,
      sessionExpiredNotice: false,
    });
    try {
      set({ user: await api.users.me() });
    } catch {
      /* profile is reloaded by screens */
    }
  },

  setUser: user =>
    set({
      user,
      needsProfileSetup: get().needsProfileSetup && !user.profileComplete,
    }),

  signOut: async ({ remote = true, expired = false } = {}) => {
    if (remote) {
      try {
        await api.auth.logout();
      } catch {
        /* best effort: local sign-out always proceeds */
      }
    }
    await tokenStore.clear();
    queryClient.clear();
    set({
      status: 'signedOut',
      user: null,
      needsProfileSetup: false,
      sessionExpiredNotice: expired,
    });
  },

  dismissSessionNotice: () => set({ sessionExpiredNotice: false }),
}));

setSessionExpiredHandler(() => {
  void useAuthStore.getState().signOut({ remote: false, expired: true });
});
