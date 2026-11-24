import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: ['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts', 'jest.config.js'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
