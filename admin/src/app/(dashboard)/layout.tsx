import Link from 'next/link';

const NAV = [
  ['/', 'Overview'],
  ['/users', 'Users'],
  ['/journeys', 'Journeys'],
  ['/routes', 'Popular routes'],
  ['/hotspots', 'Hotspots'],
  ['/traffic', 'Traffic'],
  ['/settings', 'Matching settings'],
  ['/audit', 'Audit log'],
  ['/health', 'API health'],
] as const;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 108 108" aria-hidden>
            <rect width="108" height="108" rx="24" fill="#1B4D89" />
            <path d="M54,26 L76,34 L76,52 C76,66 66,77 54,82 C42,77 32,66 32,52 L32,34 Z" fill="none" stroke="#fff" strokeWidth="5" />
            <path d="M42,66 C46,58 50,60 54,52 C58,44 62,46 66,38" fill="none" stroke="#F2A81D" strokeWidth="6" strokeLinecap="round" />
          </svg>
          EmblemWay
        </div>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
        <form action="/api/auth/logout" method="post">
          <button className="btn ghost" type="submit">
            Sign out
          </button>
        </form>
      </nav>
      <main>{children}</main>
    </div>
  );
}
