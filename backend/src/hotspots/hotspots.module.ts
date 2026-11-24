import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { HotspotModel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { HotspotsService } from './hotspots.service';
import { RouteSegmentsService } from './route-segments.service';

export class HotspotQueryDto {
  @ApiPropertyOptional({ enum: HotspotModel, default: 'JOURNEY_DEMAND' })
  @IsOptional()
  @IsEnum(HotspotModel)
  model: HotspotModel = 'JOURNEY_DEMAND';

  @ApiPropertyOptional({ example: 'PUNE' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]{2,32}$/i)
  city?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @ApiPropertyOptional({ example: 'CAR' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]{2,32}$/i)
  vehicleType?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hourFrom?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hourTo?: number;
}

export function toHotspotQuery(q: HotspotQueryDto) {
  return {
    model: q.model,
    cityCode: q.city,
    from: q.from,
    to: q.to,
    vehicleTypeCode: q.vehicleType,
    hourFrom: q.hourFrom,
    hourTo: q.hourTo,
  };
}

@ApiTags('hotspots')
@ApiBearerAuth()
@Controller('hotspots')
export class HotspotsController {
  constructor(private readonly hotspots: HotspotsService) {}

  @Get()
  heatmap(@Query() q: HotspotQueryDto) {
    return this.hotspots.query(toHotspotQuery(q));
  }

  @Get('hourly')
  hourly(@Query() q: HotspotQueryDto) {
    return this.hotspots.hourlyProfile(toHotspotQuery(q));
  }
}

@Global()
@Module({
  controllers: [HotspotsController],
  providers: [HotspotsService, RouteSegmentsService],
  exports: [HotspotsService, RouteSegmentsService],
})
export class HotspotsModule {}
