import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JourneyPurpose, MatchType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsDefined,
} from 'class-validator';
import { LocationInputDto } from '../../common/dto/location.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination';

export class CreateJourneyDto {
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

  @ApiPropertyOptional({
    type: LocationInputDto,
    description: 'Defaults to the source when omitted',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  pickup?: LocationInputDto;

  @ApiProperty({
    example: '2026-11-25T09:30:00+05:30',
    description: 'ISO-8601 with explicit offset; stored in UTC',
  })
  @IsString()
  departureAt!: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ example: 'CAR' }) @IsString() @Matches(/^[A-Z_]{2,32}$/i) vehicleTypeCode!: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() userVehicleId?: string;
  @ApiPropertyOptional({ enum: JourneyPurpose })
  @IsOptional()
  @IsEnum(JourneyPurpose)
  purpose?: JourneyPurpose;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(280) notes?: string;

  @ApiPropertyOptional({ description: 'Save without publishing (excluded from matching)' })
  @IsOptional()
  @IsBoolean()
  saveAsDraft?: boolean;

  @ApiPropertyOptional({
    description: 'Index of the alternative route to use (from route preview)',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  routeAlternativeIndex?: number;
}

export class UpdateJourneyDto {
  @ApiProperty({ description: 'Current version for optimistic concurrency control' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ type: LocationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  source?: LocationInputDto;
  @ApiPropertyOptional({ type: LocationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  destination?: LocationInputDto;
  @ApiPropertyOptional({ type: LocationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  pickup?: LocationInputDto;
  @ApiPropertyOptional() @IsOptional() @IsString() departureAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]{2,32}$/i)
  vehicleTypeCode?: string;
  @ApiPropertyOptional({ enum: JourneyPurpose })
  @IsOptional()
  @IsEnum(JourneyPurpose)
  purpose?: JourneyPurpose;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(280) notes?: string;
}

export class CancelJourneyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class ListJourneysQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['upcoming', 'history', 'drafts'], default: 'upcoming' })
  @IsOptional()
  @IsIn(['upcoming', 'history', 'drafts'])
  scope: 'upcoming' | 'history' | 'drafts' = 'upcoming';

  @ApiPropertyOptional({
    enum: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'PLANNED', 'ACTIVE', 'DRAFT'],
  })
  @IsOptional()
  @IsIn(['COMPLETED', 'CANCELLED', 'EXPIRED', 'PLANNED', 'ACTIVE', 'DRAFT'])
  status?: 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'PLANNED' | 'ACTIVE' | 'DRAFT';
}

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : value;

export class MatchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Comma separated vehicle type codes',
    example: 'CAR,MOTORCYCLE',
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsString({ each: true })
  vehicleTypes?: string[];

  @ApiPropertyOptional({ description: 'Minimum overlap ratio 0..1', example: 0.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minOverlap?: number;

  @ApiPropertyOptional({ description: 'Comma separated match types' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsEnum(MatchType, { each: true })
  matchTypes?: MatchType[];
}
