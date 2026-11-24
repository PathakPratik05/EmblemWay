import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  defaultSettings,
  SETTINGS_KEYS,
  SettingsKey,
  SettingsMap,
  settingsSchemas,
} from './settings.schema';

const CACHE_MS = 30_000;

/**
 * Reads typed settings from `app_settings`, merged over defaults, with a short
 * in-process cache. Invalid stored values fall back to defaults rather than crash.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<SettingsKey, { value: unknown; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingsKey>(key: K): Promise<SettingsMap[K]> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as SettingsMap[K];
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const merged = { ...defaultSettings(key), ...((row?.value as object | null) ?? {}) };
    const parsed = settingsSchemas[key].safeParse(merged);
    const value = (parsed.success ? parsed.data : defaultSettings(key)) as SettingsMap[K];
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async getAll(): Promise<SettingsMap> {
    const entries = await Promise.all(
      SETTINGS_KEYS.map(async (k) => [k, await this.get(k)] as const),
    );
    return Object.fromEntries(entries) as SettingsMap;
  }

  async update<K extends SettingsKey>(
    key: K,
    patch: unknown,
    actorUserId: string,
  ): Promise<SettingsMap[K]> {
    if (!SETTINGS_KEYS.includes(key)) throw AppError.notFound('Settings section');
    const current = await this.get(key);
    const parsed = settingsSchemas[key].safeParse({ ...current, ...(patch as object) });
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Invalid settings', HttpStatus.BAD_REQUEST, {
        fields: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: parsed.data, updatedById: actorUserId },
      update: { value: parsed.data, updatedById: actorUserId },
    });
    this.cache.delete(key);
    return parsed.data as SettingsMap[K];
  }

  clearCache(): void {
    this.cache.clear();
  }
}
