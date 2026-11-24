import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { SavedPlaceLabel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
  IsDefined,
} from 'class-validator';
import { LocationInputDto } from '../common/dto/location.dto';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import { haversineMeters } from '../common/utils/geo.util';
import { validateJourneyGeo } from '../journeys/domain/journey-validation';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';

class SavedPlaceDto extends LocationInputDto {
  @ApiPropertyOptional({ enum: SavedPlaceLabel })
  @IsOptional()
  @IsEnum(SavedPlaceLabel)
  label?: SavedPlaceLabel;
}

class SavedRouteDto {
  @ApiProperty({ example: 'Home to office' }) @IsString() @Length(1, 80) name!: string;
  @ApiProperty({ type: LocationInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocationInputDto)
  source!: LocationInputDto;
  @ApiProperty({ type: LocationInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocationInputDto)
  destination!: LocationInputDto;
  @ApiPropertyOptional({ type: LocationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  pickup?: LocationInputDto;
  @ApiPropertyOptional({ example: 'CAR' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]{2,32}$/i)
  vehicleTypeCode?: string;
  @ApiPropertyOptional({ example: '08:45' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  usualDepartureTime?: string;
}

class UpdateSavedRouteDto extends PartialType(SavedRouteDto) {}

const MAX_PLACES = 50;
const MAX_ROUTES = 30;

@Injectable()
export class SavedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
  ) {}

  listPlaces(userId: string) {
    return this.prisma.savedPlace.findMany({
      where: { userId },
      orderBy: [{ label: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createPlace(userId: string, dto: SavedPlaceDto) {
    validateJourneyGeo({
      source: dto,
      destination: { latitude: dto.latitude + 1, longitude: dto.longitude },
    });
    if ((await this.prisma.savedPlace.count({ where: { userId } })) >= MAX_PLACES)
      throw AppError.conflict(`You can save up to ${MAX_PLACES} places`);
    if (dto.label === 'HOME' || dto.label === 'WORK') {
      // Only one Home and one Work place - replace the previous one.
      await this.prisma.savedPlace.deleteMany({ where: { userId, label: dto.label } });
    }
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO saved_places (id, user_id, label, name, address, place_id, latitude, longitude, geom, updated_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${dto.label ?? 'OTHER'}::"SavedPlaceLabel", ${dto.name.trim()}, ${dto.address ?? null},
              ${dto.placeId ?? null}, ${dto.latitude}, ${dto.longitude}, ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326), now())
      RETURNING id`;
    return this.prisma.savedPlace.findUnique({ where: { id: rows[0]!.id } });
  }

  async deletePlace(userId: string, id: string) {
    const res = await this.prisma.savedPlace.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw AppError.notFound('Saved place');
  }

  listRoutes(userId: string) {
    return this.prisma.savedRoute.findMany({
      where: { userId },
      include: { vehicleType: { select: { code: true, name: true, icon: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createRoute(userId: string, dto: SavedRouteDto) {
    validateJourneyGeo({ source: dto.source, destination: dto.destination, pickup: dto.pickup });
    if ((await this.prisma.savedRoute.count({ where: { userId } })) >= MAX_ROUTES)
      throw AppError.conflict(`You can save up to ${MAX_ROUTES} routes`);
    const vehicleTypeId = dto.vehicleTypeCode
      ? (await this.vehicles.getActiveByCode(dto.vehicleTypeCode)).id
      : null;
    return this.prisma.savedRoute.create({
      data: { userId, ...this.routeFields(dto), vehicleTypeId },
      include: { vehicleType: { select: { code: true, name: true, icon: true } } },
    });
  }

  async updateRoute(userId: string, id: string, dto: UpdateSavedRouteDto) {
    const existing = await this.prisma.savedRoute.findFirst({ where: { id, userId } });
    if (!existing) throw AppError.notFound('Saved route');
    const source = dto.source ?? {
      latitude: existing.sourceLatitude,
      longitude: existing.sourceLongitude,
    };
    const destination = dto.destination ?? {
      latitude: existing.destinationLatitude,
      longitude: existing.destinationLongitude,
    };
    if (haversineMeters(source, destination) < 100)
      throw new AppError(
        ErrorCode.SAME_SOURCE_DESTINATION,
        'Source and destination must differ',
        HttpStatus.BAD_REQUEST,
      );
    const vehicleTypeId = dto.vehicleTypeCode
      ? (await this.vehicles.getActiveByCode(dto.vehicleTypeCode)).id
      : undefined;
    return this.prisma.savedRoute.update({
      where: { id },
      data: { ...this.routeFields(dto), vehicleTypeId },
      include: { vehicleType: { select: { code: true, name: true, icon: true } } },
    });
  }

  async deleteRoute(userId: string, id: string) {
    const res = await this.prisma.savedRoute.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw AppError.notFound('Saved route');
  }

  private routeFields(dto: Partial<SavedRouteDto>) {
    return {
      name: dto.name?.trim(),
      ...(dto.source
        ? {
            sourceName: dto.source.name,
            sourceLatitude: dto.source.latitude,
            sourceLongitude: dto.source.longitude,
            sourcePlaceId: dto.source.placeId ?? null,
          }
        : {}),
      ...(dto.destination
        ? {
            destinationName: dto.destination.name,
            destinationLatitude: dto.destination.latitude,
            destinationLongitude: dto.destination.longitude,
            destinationPlaceId: dto.destination.placeId ?? null,
          }
        : {}),
      ...(dto.pickup
        ? {
            pickupName: dto.pickup.name,
            pickupLatitude: dto.pickup.latitude,
            pickupLongitude: dto.pickup.longitude,
          }
        : {}),
      usualDepartureTime: dto.usualDepartureTime,
    } as {
      name: string;
      sourceName: string;
      sourceLatitude: number;
      sourceLongitude: number;
      destinationName: string;
      destinationLatitude: number;
      destinationLongitude: number;
    };
  }
}

@ApiTags('saved')
@ApiBearerAuth()
@Controller('users/me')
export class SavedController {
  constructor(private readonly saved: SavedService) {}

  @Get('saved-places') places(@CurrentUser() u: AuthUser) {
    return this.saved.listPlaces(u.userId);
  }

  @Post('saved-places') createPlace(@CurrentUser() u: AuthUser, @Body() dto: SavedPlaceDto) {
    return this.saved.createPlace(u.userId, dto);
  }

  @Delete('saved-places/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePlace(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.saved.deletePlace(u.userId, id);
  }

  @Get('saved-routes') routes(@CurrentUser() u: AuthUser) {
    return this.saved.listRoutes(u.userId);
  }

  @Post('saved-routes') createRoute(@CurrentUser() u: AuthUser, @Body() dto: SavedRouteDto) {
    return this.saved.createRoute(u.userId, dto);
  }

  @Patch('saved-routes/:id') updateRoute(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedRouteDto,
  ) {
    return this.saved.updateRoute(u.userId, id, dto);
  }

  @Delete('saved-routes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRoute(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.saved.deleteRoute(u.userId, id);
  }
}

@Module({ controllers: [SavedController], providers: [SavedService] })
export class SavedModule {}
