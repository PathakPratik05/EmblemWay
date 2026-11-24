import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BackendError, backendFetch, FetchOptions } from './backend';
import { ACCESS_COOKIE } from './session';

/**
 * Authenticated admin API call from Server Components / Server Actions. The middleware keeps
 * the access token fresh; an auth failure here means the session is gone, so go to login.
 */
export async function adminApi<T>(path: string, opts: Omit<FetchOptions, 'token'> = {}): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/login');
  try {
    return await backendFetch<T>(path, { ...opts, token });
  } catch (err) {
    if (err instanceof BackendError && (err.status === 401 || err.status === 403)) redirect('/login?reason=session');
    throw err;
  }
}
