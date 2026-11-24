import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateUserVehicleDto {
  @ApiProperty({ example: 'CAR' })
  @IsString()
  @Matches(/^[A-Z_]{2,32}$/i)
  vehicleTypeCode!: string;

  @ApiPropertyOptional({ example: 'Office car' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  nickname?: string;
  @ApiPropertyOptional({ example: 'Tata Nexon EV' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  makeModel?: string;
  @ApiPropertyOptional({ example: 'White' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;
  @ApiPropertyOptional({ example: 4 }) @IsOptional() @IsInt() @Min(1) @Max(60) seats?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateUserVehicleDto extends PartialType(CreateUserVehicleDto) {}
