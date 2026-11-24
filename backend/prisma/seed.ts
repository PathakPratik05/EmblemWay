/**
 * Reference-data seed (idempotent): cities, vehicle categories, default settings and the
 * bootstrap admin account. Safe to run on every deploy. Contains no user/journey data.
 *   npm run db:seed
 */
import { PrismaClient, RoutingProfile } from '@prisma/client';
import { randomBytes, scrypt } from 'node:crypto';

// Load .env for local runs; containers receive configuration as real environment variables.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv/config');
} catch {
  /* dotenv not installed in production images */
}

const prisma = new PrismaClient();

const CITIES = [
  {
    code: 'PUNE',
    name: 'Pune',
    state: 'Maharashtra',
    centerLatitude: 18.5204,
    centerLongitude: 73.8567,
    radiusMeters: 40_000,
    isActive: true,
  },
  // Future expansion: set is_active = true to launch. No algorithm change required.
  {
    code: 'MUMBAI',
    name: 'Mumbai',
    state: 'Maharashtra',
    centerLatitude: 19.076,
    centerLongitude: 72.8777,
    radiusMeters: 45_000,
    isActive: false,
  },
  {
    code: 'BENGALURU',
    name: 'Bengaluru',
    state: 'Karnataka',
    centerLatitude: 12.9716,
    centerLongitude: 77.5946,
    radiusMeters: 40_000,
    isActive: false,
  },
];

interface VehicleSeed {
  code: string;
  name: string;
  icon: string;
  routingProfile: RoutingProfile;
  trafficSupported: boolean;
  approximationNote: string | null;
  poolingEligible: boolean;
  defaultSeats: number;
}

const VEHICLES: VehicleSeed[] = [
  {
    code: 'MOTORCYCLE',
    name: 'Motorcycle',
    icon: 'motorbike',
    routingProfile: 'TWO_WHEELER',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: true,
    defaultSeats: 1,
  },
  {
    code: 'SCOOTER',
    name: 'Scooter',
    icon: 'moped',
    routingProfile: 'TWO_WHEELER',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: true,
    defaultSeats: 1,
  },
  {
    code: 'CAR',
    name: 'Car',
    icon: 'car',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: true,
    defaultSeats: 4,
  },
  {
    code: 'TAXI',
    name: 'Taxi',
    icon: 'taxi',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: false,
    defaultSeats: 4,
  },
  {
    code: 'AUTO_RICKSHAW',
    name: 'Auto rickshaw',
    icon: 'rickshaw',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote: 'Three-wheeler routes and times are approximated using car routing.',
    poolingEligible: false,
    defaultSeats: 3,
  },
  {
    code: 'BUS',
    name: 'Bus',
    icon: 'bus',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote:
      'Bus routes and times are approximated using car routing; stops and bus lanes are not modelled.',
    poolingEligible: false,
    defaultSeats: 1,
  },
  {
    code: 'BICYCLE',
    name: 'Bicycle',
    icon: 'bicycle',
    routingProfile: 'BICYCLE',
    trafficSupported: false,
    approximationNote: 'Traffic-aware estimates are not available for bicycles.',
    poolingEligible: false,
    defaultSeats: 1,
  },
  {
    code: 'ELECTRIC_VEHICLE',
    name: 'Electric vehicle',
    icon: 'car-electric',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: true,
    defaultSeats: 4,
  },
  {
    code: 'VAN',
    name: 'Van',
    icon: 'van-passenger',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote: null,
    poolingEligible: true,
    defaultSeats: 7,
  },
  {
    code: 'TRUCK',
    name: 'Truck',
    icon: 'truck',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote:
      'Truck routes are approximated using car routing; heavy-vehicle restrictions are not modelled.',
    poolingEligible: false,
    defaultSeats: 1,
  },
  {
    code: 'OTHER',
    name: 'Other',
    icon: 'dots-horizontal',
    routingProfile: 'DRIVE',
    trafficSupported: true,
    approximationNote: 'Routes are approximated using car routing.',
    poolingEligible: false,
    defaultSeats: 1,
  },
];

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err
        ? reject(err)
        : resolve(`scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`),
    ),
  );
}

async function main(): Promise<void> {
  for (const c of CITIES) {
    await prisma.city.upsert({
      where: { code: c.code },
      create: c,
      update: {
        name: c.name,
        state: c.state,
        centerLatitude: c.centerLatitude,
        centerLongitude: c.centerLongitude,
        radiusMeters: c.radiusMeters,
      },
    });
  }
  for (const [i, v] of VEHICLES.entries()) {
    await prisma.vehicleType.upsert({
      where: { code: v.code },
      create: { ...v, sortOrder: i },
      update: { ...v, sortOrder: i },
    });
  }

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (email && password) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    });
    if (!existing) {
      await prisma.user.create({
        data: {
          role: 'SUPER_ADMIN',
          firstName: 'EmblemWay',
          lastName: 'Admin',
          email: email.toLowerCase(),
          passwordHash: await hashPassword(password),
          profile: { create: { profileCompletedAt: new Date() } },
        },
      });
      console.log(`Created bootstrap admin ${email} - change the password after first login.`);
    }
  } else {
    console.log('ADMIN_BOOTSTRAP_EMAIL/PASSWORD not set - skipping admin bootstrap.');
  }
  console.log(`Seeded ${CITIES.length} cities and ${VEHICLES.length} vehicle categories.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
