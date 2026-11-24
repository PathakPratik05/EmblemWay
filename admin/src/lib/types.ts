export interface Overview {
  users: { total: number; activeLast30Days: number; newLast7Days: number };
  journeys: { total: number; byStatus: Record<string, number>; activeNow: number };
  matches: { pairs: number; averageScore: number | null };
  generatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
  mobileNumberMasked: string | null;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  journeys: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminJourney {
  id: string;
  status: string;
  departureAt: string;
  vehicleType: { code: string; name: string };
  city: { code: string; name: string } | null;
  user: { id: string; firstName: string; lastName: string };
  source: string | null;
  destination: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  provider: string | null;
  matches: number;
}

export interface SettingsMap {
  matching: Record<string, number | boolean>;
  hotspots: Record<string, number>;
  traffic: Record<string, number>;
  journeys: Record<string, number>;
}
