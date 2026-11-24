import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Strongly typed accessor over the validated environment. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProductionLike(): boolean {
    const env = this.get('NODE_ENV');
    return env === 'production' || env === 'staging';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }
}
