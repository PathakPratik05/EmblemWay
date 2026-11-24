import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const NAME_PATTERN = /^[\p{L}][\p{L} .'-]*$/u;

export class RequestOtpDto {
  @ApiProperty({ example: '+91', description: 'International dialling code' })
  @IsString()
  @Matches(/^\+?\d{1,4}$/)
  countryCode!: string;

  @ApiProperty({ example: '9876543210', description: 'National mobile number' })
  @IsString()
  @Length(6, 20)
  mobileNumber!: string;
}

export class DeviceInfoDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) deviceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) deviceName?: string;
  @ApiPropertyOptional({ enum: ['android', 'ios', 'web'] })
  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  platform?: string;
}

export class VerifyOtpDto extends DeviceInfoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'code must be 4-8 digits' })
  code!: string;

  @ApiPropertyOptional({ description: 'Required when registering a new account' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Matches(NAME_PATTERN, { message: 'firstName contains invalid characters' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'Required when registering a new account' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Matches(NAME_PATTERN, { message: 'lastName contains invalid characters' })
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class RefreshTokenDto extends DeviceInfoDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken!: string;
}

export class AdminLoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(200) password!: string;
}
