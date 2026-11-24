import * as Keychain from 'react-native-keychain';
import type { TokenPair } from '../api/types';

const SERVICE = 'com.emblemway.app.auth';

export interface TokenStore {
  get(): Promise<TokenPair | null>;
  set(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Tokens live in the Android Keystore-backed keychain (encrypted at rest, this device only).
 * They are never written to AsyncStorage, logs or JS-visible files.
 */
class KeychainTokenStore implements TokenStore {
  private cache: TokenPair | null | undefined;

  async get(): Promise<TokenPair | null> {
    if (this.cache !== undefined) return this.cache;
    try {
      const creds = await Keychain.getGenericPassword({ service: SERVICE });
      this.cache = creds ? (JSON.parse(creds.password) as TokenPair) : null;
    } catch {
      // Corrupted entry or keystore reset (e.g. device credential change): treat as signed out.
      this.cache = null;
    }
    return this.cache;
  }

  async set(tokens: TokenPair): Promise<void> {
    this.cache = tokens;
    await Keychain.setGenericPassword('emblemway', JSON.stringify(tokens), {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  async clear(): Promise<void> {
    this.cache = null;
    await Keychain.resetGenericPassword({ service: SERVICE });
  }
}

export const tokenStore: TokenStore = new KeychainTokenStore();
