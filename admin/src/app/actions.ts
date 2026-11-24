'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';
import { parseSettingsForm } from '@/lib/settings-form';

export interface ActionState {
  ok: boolean;
  message: string;
}

const uuid = z.string().uuid();

/** Server Actions: run on the server with the admin's httpOnly session; Next verifies the Origin. */
export async function setUserStatus(formData: FormData): Promise<void> {
  const id = uuid.parse(formData.get('userId'));
  const status = z.enum(['ACTIVE', 'SUSPENDED']).parse(formData.get('status'));
  await adminApi(`/admin/users/${id}/status`, { method: 'PATCH', body: { status } });
  revalidatePath('/users');
}

export async function cancelJourney(formData: FormData): Promise<void> {
  const id = uuid.parse(formData.get('journeyId'));
  await adminApi(`/admin/journeys/${id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by administrator' } });
  revalidatePath('/journeys');
}

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const section = z.enum(['matching', 'hotspots', 'traffic', 'journeys']).parse(formData.get('section'));
  const booleans = String(formData.get('$booleans') ?? '')
    .split(',')
    .filter(Boolean);
  try {
    await adminApi(`/admin/settings/${section}`, { method: 'PATCH', body: parseSettingsForm(formData, booleans) });
    revalidatePath('/settings');
    return { ok: true, message: `Saved ${section} settings.` };
  } catch (err) {
    if (err instanceof BackendError) {
      const fields = (err.details as { fields?: string[] } | undefined)?.fields;
      return { ok: false, message: fields?.length ? fields.join('; ') : err.message };
    }
    return { ok: false, message: 'Could not save settings.' };
  }
}

export async function runMaintenance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const task = z.enum(['aggregate-hotspots', 'expire-journeys', 'auto-complete', 'retention']).parse(formData.get('task'));
  try {
    const res = await adminApi<{ result: unknown }>(`/admin/maintenance/${task}`, { method: 'POST' });
    revalidatePath('/hotspots');
    return { ok: true, message: `Done: ${JSON.stringify(res.result)}` };
  } catch (err) {
    return { ok: false, message: err instanceof BackendError ? err.message : 'Task failed.' };
  }
}
