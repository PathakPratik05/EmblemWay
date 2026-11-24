import { z } from 'zod';
import { isValidCoordinate, haversineMeters } from '../utils/geo';

const NAME = /^[\p{L}][\p{L} .'-]*$/u;

/** Indian mobile: 10 digits starting 6-9 (spaces/dashes and +91 / 0 prefixes tolerated). */
export function normalizeIndianMobile(raw: string): string | null {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const mobileSchema = z
  .string()
  .trim()
  .min(1, 'Enter your mobile number')
  .refine(
    v => normalizeIndianMobile(v) !== null,
    'Enter a valid 10-digit Indian mobile number',
  );

export const loginSchema = z.object({ mobileNumber: mobileSchema });

export const registerSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'Enter your first name')
    .max(60, 'Too long')
    .regex(NAME, 'Use letters only'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Enter your last name')
    .max(60, 'Too long')
    .regex(NAME, 'Use letters only'),
  mobileNumber: mobileSchema,
  email: z
    .string()
    .trim()
    .email('Enter a valid email')
    .max(254)
    .optional()
    .or(z.literal('')),
});

export const otpSchema = (length = 6) =>
  z.object({
    code: z
      .string()
      .trim()
      .regex(new RegExp(`^\\d{${length}}$`), `Enter the ${length}-digit code`),
  });

export const profileSchema = z.object({
  firstName: registerSchema.shape.firstName,
  lastName: registerSchema.shape.lastName,
  email: registerSchema.shape.email,
  preferredCityCode: z.string().min(1, 'Choose your city'),
  defaultVehicleTypeCode: z.string().min(1, 'Choose a vehicle'),
});

const placeSchema = z
  .object({
    name: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().nullish(),
    placeId: z.string().nullish(),
  })
  .refine(p => isValidCoordinate(p), 'Invalid location');

/** Client-side journey checks (the server re-validates everything). */
export const journeySchema = z
  .object({
    source: placeSchema
      .nullable()
      .refine(v => v !== null, 'Choose where you start'),
    destination: placeSchema
      .nullable()
      .refine(v => v !== null, 'Choose your destination'),
    pickup: placeSchema.nullable(),
    departureAt: z.date({ required_error: 'Choose a departure time' }),
    vehicleTypeCode: z.string().min(1, 'Choose a vehicle'),
  })
  .superRefine((v, ctx) => {
    if (
      v.source &&
      v.destination &&
      haversineMeters(v.source, v.destination) < 100
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Destination must be different from the start',
      });
    }
    if (
      v.pickup &&
      v.destination &&
      haversineMeters(v.pickup, v.destination) < 100
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['pickup'],
        message: 'Pickup cannot be the destination',
      });
    }
    if (v.departureAt.getTime() < Date.now() - 5 * 60_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['departureAt'],
        message: 'Departure time is in the past',
      });
    }
    if (v.departureAt.getTime() > Date.now() + 90 * 86_400_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['departureAt'],
        message: 'You can plan up to 90 days ahead',
      });
    }
  });

export type JourneyFormValues = z.infer<typeof journeySchema>;
