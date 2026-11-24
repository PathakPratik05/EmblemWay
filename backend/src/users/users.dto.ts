import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const NAME_PATTERN = /^[\p{L}][\p{L} .'-]*$/u;

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Matches(NAME_PATTERN)
  firstName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Matches(NAME_PATTERN)
  lastName?: string;

  @ApiPropertyOptional({ description: 'Empty string clears the email' })
  @IsOptional()
  @ValidateIf((o: UpdateProfileDto) => o.email !== '')
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: 'PUNE' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]{2,32}$/i)
  preferredCityCode?: string;
  @ApiPropertyOptional({ example: 'CAR' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]{2,32}$/i)
  defaultVehicleTypeCode?: string;
  @ApiPropertyOptional({ description: 'Marks profile setup as complete' })
  @IsOptional()
  @IsBoolean()
  completeProfile?: boolean;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shareJourneysForMatching?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showFirstNameToMatches?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyJourneyReminders?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyMatches?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyStatusUpdates?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyTrafficAlerts?: boolean;
  @ApiPropertyOptional({ description: 'Records (true) or withdraws (false) location consent' })
  @IsOptional()
  @IsBoolean()
  locationConsent?: boolean;
}
