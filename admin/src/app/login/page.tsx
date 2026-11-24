import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <div className="login">
      <LoginForm notice={reason === 'session' ? 'Your session ended. Please sign in again.' : undefined} />
    </div>
  );
}
