import { LatLng } from '../../common/utils/geo.util';
import {
  MapsProviderError,
  PlaceDetails,
  PlaceSuggestion,
  PlacesProvider,
  ReverseGeocodeResult,
} from '../maps.types';
import { QuotaGuard } from '../resilience/quota.guard';
import { GoogleHttpClient } from './google-http.client';

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }>;
}

interface PlaceResponse {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

interface GeocodeResponse {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    place_id?: string;
    address_components?: Array<{ long_name: string; types: string[] }>;
  }>;
}

/** Places API (New) for autocomplete/details and the Geocoding API for reverse geocoding. */
export class GooglePlacesProvider implements PlacesProvider {
  readonly name = 'google';

  constructor(
    private readonly http: GoogleHttpClient,
    private readonly apiKey: string,
    private readonly quota: QuotaGuard,
  ) {}

  async autocomplete(
    input: string,
    sessionToken: string | undefined,
    bias?: { center: LatLng; radiusMeters: number },
  ): Promise<PlaceSuggestion[]> {
    await this.quota.acquire('places');
    const res = await this.http.request<AutocompleteResponse>(
      {
        url: 'https://places.googleapis.com/v1/places:autocomplete',
        method: 'POST',
        headers: { 'X-Goog-Api-Key': this.apiKey },
        body: {
          input,
          ...(sessionToken ? { sessionToken } : {}),
          includedRegionCodes: ['in'],
          languageCode: 'en',
          ...(bias
            ? {
                locationBias: {
                  circle: { center: bias.center, radius: Math.min(50_000, bias.radiusMeters) },
                },
              }
            : {}),
        },
      },
      'places.autocomplete',
    );
    return (res.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
      .map((p) => ({
        placeId: p.placeId!,
        primaryText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
        fullText: p.text?.text ?? '',
      }));
  }

  async details(placeId: string, sessionToken: string | undefined): Promise<PlaceDetails> {
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId))
      throw new MapsProviderError('REJECTED', 'Invalid place id');
    await this.quota.acquire('places');
    const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
    const res = await this.http.request<PlaceResponse>(
      {
        url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${qs}`,
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
        },
      },
      'places.details',
    );
    if (res.location?.latitude === undefined || res.location.longitude === undefined) {
      throw new MapsProviderError('NOT_FOUND', 'Place has no location');
    }
    return {
      placeId: res.id ?? placeId,
      name: res.displayName?.text ?? res.formattedAddress ?? 'Selected place',
      address: res.formattedAddress ?? '',
      location: { latitude: res.location.latitude, longitude: res.location.longitude },
    };
  }

  async reverseGeocode(point: LatLng): Promise<ReverseGeocodeResult> {
    await this.quota.acquire('geocode');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.latitude},${point.longitude}&language=en&region=in`;
    const res = await this.http.request<GeocodeResponse>(
      // The Geocoding API (legacy web service) accepts the key only as a query parameter.
      { url: `${url}&key=${encodeURIComponent(this.apiKey)}`, method: 'GET', headers: {} },
      'geocode.reverse',
    );
    switch (res.status) {
      case 'OK': {
        const first = res.results?.[0];
        const locality = first?.address_components?.find(
          (c) => c.types.includes('sublocality') || c.types.includes('locality'),
        )?.long_name;
        return {
          placeId: first?.place_id ?? null,
          address: first?.formatted_address ?? '',
          name: locality ?? first?.formatted_address ?? 'Pinned location',
        };
      }
      case 'ZERO_RESULTS':
        return {
          placeId: null,
          address: '',
          name: `Pinned location (${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)})`,
        };
      case 'OVER_QUERY_LIMIT':
      case 'OVER_DAILY_LIMIT':
        throw new MapsProviderError('QUOTA', `Geocoding quota exceeded`);
      case 'REQUEST_DENIED':
      case 'INVALID_REQUEST':
        throw new MapsProviderError('REJECTED', `Geocoding rejected: ${res.status}`);
      default:
        throw new MapsProviderError('UNAVAILABLE', `Geocoding failed: ${res.status ?? 'unknown'}`);
    }
  }
}
