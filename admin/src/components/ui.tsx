import Link from 'next/link';

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card" data-testid={`stat-${label}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="muted">{hint}</div> : null}
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'success',
  COMPLETED: 'success',
  PLANNED: '',
  DRAFT: 'warning',
  CANCELLED: 'danger',
  EXPIRED: 'warning',
  SUSPENDED: 'danger',
  DELETED: 'danger',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_CLASS[status] ?? ''}`}>{status.toLowerCase()}</span>;
}

export function Pager({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (page: number) => string }) {
  return (
    <nav className="pager" aria-label="Pagination">
      {page > 1 ? <Link className="btn secondary" href={hrefFor(page - 1)}>Previous</Link> : null}
      <span className="muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? <Link className="btn secondary" href={hrefFor(page + 1)}>Next</Link> : null}
    </nav>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="card error" role="alert">
      {message}
    </div>
  );
}

export function formatDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function km(meters: number | null | undefined): string {
  return meters === null || meters === undefined ? '—' : `${(meters / 1000).toFixed(1)} km`;
}
