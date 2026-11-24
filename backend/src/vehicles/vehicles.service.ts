import { HttpStatus, Injectable } from '@nestjs/common';
import { VehicleType } from '@prisma/client';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserVehicleDto, UpdateUserVehicleDto } from './vehicles.dto';

export interface VehicleTypeView {
  id: string;
  code: string;
  name: string;
  icon: string;
  routingProfile: VehicleType['routingProfile'];
  trafficSupported: boolean;
  approximationNote: string | null;
  poolingEligible: boolean;
  defaultSeats: number;
}

const CACHE_MS = 60_000;

@Injectable()
export class VehiclesService {
  private cache: { at: number; items: VehicleType[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Active vehicle categories - the single source of truth for every client. */
  async listTypes(): Promise<VehicleTypeView[]> {
    return (await this.activeTypes()).map(toView);
  }

  private async activeTypes(): Promise<VehicleType[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.items;
    const items = await this.prisma.vehicleType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    this.cache = { at: Date.now(), items };
    return items;
  }

  async getActiveByCode(code: string): Promise<VehicleType> {
    const type = (await this.activeTypes()).find((t) => t.code === code.toUpperCase());
    if (!type)
      throw new AppError(
        ErrorCode.INVALID_VEHICLE_TYPE,
        `Unknown or inactive vehicle category: ${code}`,
        HttpStatus.BAD_REQUEST,
      );
    return type;
  }

  async getById(id: string): Promise<VehicleType> {
    const type = await this.prisma.vehicleType.findUnique({ where: { id } });
    if (!type) throw AppError.notFound('Vehicle type');
    return type;
  }

  invalidate(): void {
    this.cache = null;
  }

  // ─── User vehicles ────────────────────────────────────────────

  async listUserVehicles(userId: string) {
    return this.prisma.userVehicle.findMany({
      where: { userId, deletedAt: null },
      include: { vehicleType: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createUserVehicle(userId: string, dto: CreateUserVehicleDto) {
    const type = await this.getActiveByCode(dto.vehicleTypeCode);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.userVehicle.count({ where: { userId, deletedAt: null } });
      if (count >= 10)
        throw new AppError(
          ErrorCode.CONFLICT,
          'You can save at most 10 vehicles',
          HttpStatus.CONFLICT,
        );
      const makeDefault = dto.isDefault ?? count === 0;
      if (makeDefault)
        await tx.userVehicle.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      return tx.userVehicle.create({
        data: {
          userId,
          vehicleTypeId: type.id,
          nickname: dto.nickname,
          makeModel: dto.makeModel,
          color: dto.color,
          seats: dto.seats,
          isDefault: makeDefault,
        },
        include: { vehicleType: true },
      });
    });
  }

  async updateUserVehicle(userId: string, id: string, dto: UpdateUserVehicleDto) {
    const existing = await this.prisma.userVehicle.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) throw AppError.notFound('Vehicle');
    const typeId = dto.vehicleTypeCode
      ? (await this.getActiveByCode(dto.vehicleTypeCode)).id
      : undefined;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault)
        await tx.userVehicle.updateMany({
          where: { userId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      return tx.userVehicle.update({
        where: { id },
        data: {
          vehicleTypeId: typeId,
          nickname: dto.nickname,
          makeModel: dto.makeModel,
          color: dto.color,
          seats: dto.seats,
          isDefault: dto.isDefault,
        },
        include: { vehicleType: true },
      });
    });
  }

  async deleteUserVehicle(userId: string, id: string): Promise<void> {
    const res = await this.prisma.userVehicle.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date(), isDefault: false },
    });
    if (res.count === 0) throw AppError.notFound('Vehicle');
  }
}

export function toView(t: VehicleType): VehicleTypeView {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    icon: t.icon,
    routingProfile: t.routingProfile,
    trafficSupported: t.trafficSupported,
    approximationNote: t.approximationNote,
    poolingEligible: t.poolingEligible,
    defaultSeats: t.defaultSeats,
  };
}
