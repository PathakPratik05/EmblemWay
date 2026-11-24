import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
  IsDefined,
} from 'class-validator';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { CoordinatesDto } from '../common/dto/location.dto';
import { encodePolyline, haversineMeters } from '../common/utils/geo.util';
import { VehiclesService } from '../vehicles/vehicles.service';
import { toAppError } from './maps-error.mapper';
import { PLACES_PROVIDER, PlacesProvider } from './maps.types';
import { RoutingService } from './routing.service';

class AutocompleteQueryDto {
  @ApiProperty({ example: 'Hinjewadi' }) @IsString() @Length(2, 120) input!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) sessionToken?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @IsLongitude() lng?: number;
}

class ReverseGeocodeQueryDto {
  @ApiProperty() @Type(() => Number) @IsNumber() @IsLatitude() lat!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @IsLongitude() lng!: number;
}

class RoutePreviewDto {
  @ApiProperty({ type: CoordinatesDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  source!: CoordinatesDto;
  @ApiProperty({ type: CoordinatesDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  destination!: CoordinatesDto;
  @ApiPropertyOptional({ type: CoordinatesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  pickup?: CoordinatesDto;
  @ApiProperty({ example: 'CAR' }) @IsString() @Matches(/^[A-Z_]{2,32}$/i) vehicleTypeCode!: string;
}

/**
 * Server-side proxy for Places / Geocoding / Routes. Keeps the server API key off the
 * device; the mobile app only holds the Android-restricted Maps SDK key.
 */
@ApiTags('maps')
@ApiBearerAuth()
@Controller()
export class MapsController {
  constructor(
    @Inject(PLACES_PROVIDER) private readonly places: PlacesProvider,
    private readonly routing: RoutingService,
    private readonly vehicles: VehiclesService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('places/autocomplete')
  async autocomplete(@Query() q: AutocompleteQueryDto) {
    try {
      const bias =
        q.lat !== undefined && q.lng !== undefined
          ? { center: { latitude: q.lat, longitude: q.lng }, radiusMeters: 30_000 }
          : undefined;
      return {
        provider: this.places.name,
        suggestions: await this.places.autocomplete(q.input, q.sessionToken, bias),
      };
    } catch (err) {
      throw toAppError(err);
    }
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('places/reverse-geocode')
  async reverseGeocode(@Query() q: ReverseGeocodeQueryDto) {
    try {
      return await this.places.reverseGeocode({ latitude: q.lat, longitude: q.lng });
    } catch (err) {
      throw toAppError(err);
    }
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('places/:placeId')
  async details(@Param('placeId') placeId: string, @Query('sessionToken') sessionToken?: string) {
    try {
      return await this.places.details(placeId, sessionToken?.slice(0, 64));
    } catch (err) {
      throw toAppError(err);
    }
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('routes/preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Body() dto: RoutePreviewDto) {
    if (haversineMeters(dto.source, dto.destination) < 50) {
      throw new AppError(
        ErrorCode.SAME_SOURCE_DESTINATION,
        'Source and destination must be different places',
        HttpStatus.BAD_REQUEST,
      );
    }
    const type = await this.vehicles.getActiveByCode(dto.vehicleTypeCode);
    const routes = await this.routing.planRoutes({
      source: dto.source,
      destination: dto.destination,
      pickup: dto.pickup,
      profile: type.routingProfile,
    });
    return {
      provider: this.routing.providerName,
      isLiveData: this.routing.isLive,
      routingProfile: type.routingProfile,
      approximationNote: type.approximationNote,
      routes: routes.map((r) => ({
        alternativeIndex: r.alternativeIndex,
        encodedPolyline: encodePolyline(r.points),
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        staticDurationSeconds: r.staticDurationSeconds,
        labels: r.labels,
      })),
    };
  }
}
