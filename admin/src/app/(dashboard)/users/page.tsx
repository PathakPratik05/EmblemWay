import { setUserStatus } from '@/app/actions';
import { ErrorPanel, formatDateTime, Pager, StatusBadge } from '@/components/ui';
import { BackendError } from '@/lib/backend';
import { adminApi } from '@/lib/server-api';
import type { AdminUser, Paginated } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let data: Paginated<AdminUser>;
  try {
    data = await adminApi<Paginated<AdminUser>>('/admin/users', { query: { search: sp.search, status: sp.status, page, pageSize: 25 } });
  } catch (err) {
    return <ErrorPanel message={err instanceof BackendError ? err.message : 'Could not load users.'} />;
  }
  const qs = (p: number) => `/users?${new URLSearchParams({ ...(sp.search ? { search: sp.search } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;
  return (
    <>
      <h1>Users</h1>
      <form className="filters" method="get">
        <label>
          Search name, email or last digits
          <input name="search" defaultValue={sp.search ?? ''} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">Active & suspended</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DELETED">Deleted</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      <p className="muted">{data.total} users · mobile numbers are always masked</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Mobile</th>
            <th>Status</th>
            <th>Journeys</th>
            <th>Last login</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.items.map((u) => (
            <tr key={u.id}>
              <td>
                {u.firstName} {u.lastName}
                <div className="muted">{u.email}</div>
              </td>
              <td>{u.mobileNumberMasked ?? '—'}</td>
              <td>
                <StatusBadge status={u.status} />
              </td>
              <td>{u.journeys}</td>
              <td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</td>
              <td>{formatDateTime(u.createdAt)}</td>
              <td>
                {u.status !== 'DELETED' ? (
                  <form action={setUserStatus}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="status" value={u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'} />
                    <button className={`btn ${u.status === 'ACTIVE' ? 'danger' : 'secondary'}`} type="submit">
                      {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={data.page} totalPages={data.totalPages} hrefFor={qs} />
    </>
  );
}
