'use client';

import { useActionState } from 'react';
import { ActionState, runMaintenance } from '@/app/actions';

export function MaintenanceButton({ task, label }: { task: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(runMaintenance, { ok: true, message: '' });
  return (
    <form action={action}>
      <input type="hidden" name="task" value={task} />
      <button className="btn secondary" type="submit" disabled={pending}>
        {pending ? 'Running…' : label}
      </button>
      {state.message ? (
        <p className={state.ok ? 'muted' : 'error'} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
