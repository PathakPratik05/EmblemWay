import { ErrorPanel, formatDateTime, Pager } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';
import type { Paginated } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface AuditRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  requestId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { firstName: string; lastName: string; role: string } | null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let data: Paginated<AuditRow>;
  try {
    data = await adminApi<Paginated<AuditRow>>('/admin/audit-logs', { query: { action: sp.action, page, pageSize: 50 } });
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load the audit log.'} />;
  }
  return (
    <>
      <h1>Audit log</h1>
      <form className="filters" method="get">
        <label>
          Action prefix
          <input name="action" placeholder="e.g. admin. or auth." defaultValue={sp.action ?? ''} />
        </label>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Time (IST)</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Entity</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.id}>
              <td>{formatDateTime(r.createdAt)}</td>
              <td>
                <code>{r.action}</code>
              </td>
              <td>{r.actor ? `${r.actor.firstName} ${r.actor.lastName} (${r.actor.role.toLowerCase()})` : 'system / anonymous'}</td>
              <td>
                {r.entityType ?? ''} {r.entityId ? <span className="muted">{r.entityId.slice(0, 8)}…</span> : null}
              </td>
              <td className="muted">{r.metadata ? JSON.stringify(r.metadata) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={data.page} totalPages={data.totalPages} hrefFor={(p) => `/audit?page=${p}${sp.action ? `&action=${encodeURIComponent(sp.action)}` : ''}`} />
    </>
  );
}
