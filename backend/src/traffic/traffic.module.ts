import {
  Body,
  Controller,
  Get,
  Global,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, ValidateNested, IsDefined } from 'class-validator';
import { CoordinatesDto } from '../common/dto/location.dto';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import { TrafficService } from './traffic.service';

class TrafficPredictionDto {
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

@ApiTags('traffic')
@ApiBearerAuth()
@Controller('traffic')
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Get('journeys/:id/predictions')
  @ApiOperation({
    summary: 'Traffic-aware estimates for leaving now, +15, +30, +45 and +60 minutes',
  })
  forJourney(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.traffic.predictForJourney(id, user.userId);
  }

  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('predictions')
  @HttpCode(HttpStatus.OK)
  adHoc(@Body() dto: TrafficPredictionDto) {
    return this.traffic.predictAdHoc(dto);
  }
}

@Global()
@Module({
  controllers: [TrafficController],
  providers: [TrafficService],
  exports: [TrafficService],
})
export class TrafficModule {}
