import NetInfo from '@react-native-community/netinfo';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HotspotModel } from '../api/types';

export const keys = {
  me: ['me'] as const,
  vehicleTypes: ['vehicle-types'] as const,
  cities: ['cities'] as const,
  journeys: (scope: string) => ['journeys', scope] as const,
  journey: (id: string) => ['journey', id] as const,
  matches: (id: string, filters: object) => ['matches', id, filters] as const,
  segments: (id: string) => ['segments', id] as const,
  traffic: (id: string) => ['traffic', id] as const,
  hotspots: (q: object) => ['hotspots', q] as const,
  notifications: ['notifications'] as const,
  savedRoutes: ['saved-routes'] as const,
  savedPlaces: ['saved-places'] as const,
  vehicles: ['user-vehicles'] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: api.users.me });
/** Vehicle categories always come from the backend - never hard-coded in the UI. */
export const useVehicleTypes = () =>
  useQuery({
    queryKey: keys.vehicleTypes,
    queryFn: api.meta.vehicleTypes,
    staleTime: 3600_000,
  });
export const useCities = () =>
  useQuery({
    queryKey: keys.cities,
    queryFn: api.meta.cities,
    staleTime: 3600_000,
  });

export function useJourneyList(
  scope: 'upcoming' | 'history' | 'drafts',
  status?: string,
) {
  return useInfiniteQuery({
    queryKey: [...keys.journeys(scope), status ?? 'all'],
    queryFn: ({ pageParam }) => api.journeys.list(scope, pageParam, status),
    initialPageParam: 1,
    getNextPageParam: last => (last.hasNextPage ? last.page + 1 : undefined),
  });
}

export const useJourney = (id: string) =>
  useQuery({ queryKey: keys.journey(id), queryFn: () => api.journeys.get(id) });

export const useMatches = (
  id: string,
  filters: { vehicleTypes?: string[]; minOverlap?: number },
) =>
  useQuery({
    queryKey: keys.matches(id, filters),
    queryFn: () => api.journeys.matches(id, filters),
  });

export const useSegments = (id: string, enabled = true) =>
  useQuery({
    queryKey: keys.segments(id),
    queryFn: () => api.journeys.segments(id),
    enabled,
  });

/** Traffic is never kept beyond 5 minutes on the client; the server labels freshness. */
export const useTraffic = (id: string, enabled = true) =>
  useQuery({
    queryKey: keys.traffic(id),
    queryFn: () => api.traffic.forJourney(id),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    enabled,
  });

export const useHotspots = (q: {
  model: HotspotModel;
  vehicleType?: string;
  city?: string;
  hourFrom?: number;
  hourTo?: number;
  from?: string;
}) =>
  useQuery({ queryKey: keys.hotspots(q), queryFn: () => api.hotspots.get(q) });

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.notifications.list(1),
    refetchInterval: 60_000,
  });
export const useSavedRoutes = () =>
  useQuery({ queryKey: keys.savedRoutes, queryFn: api.saved.routes });
export const useSavedPlaces = () =>
  useQuery({ queryKey: keys.savedPlaces, queryFn: api.saved.places });
export const useUserVehicles = () =>
  useQuery({ queryKey: keys.vehicles, queryFn: api.users.vehicles });

/** null while unknown; treats "reachable === false" as offline. */
export function useIsOnline(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(
    () =>
      NetInfo.addEventListener(s => {
        setOnline(
          s.isConnected === false || s.isInternetReachable === false
            ? false
            : true,
        );
      }),
    [],
  );
  return online;
}
