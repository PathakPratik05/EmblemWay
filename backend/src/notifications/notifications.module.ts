import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AppConfigService } from '../config/app-config.service';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../common/pagination/pagination';
import { NotificationsService } from './notifications.service';
import { FcmPushProvider, NoopPushProvider, PUSH_PROVIDER, PushProvider } from './push.provider';

class ListNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}

class DeviceTokenDto {
  @ApiProperty() @IsString() @Length(20, 512) token!: string;
  @ApiPropertyOptional({ enum: ['android', 'ios'] })
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListNotificationsDto) {
    return this.notifications.list(user.userId, q);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async readAll(@CurrentUser() user: AuthUser) {
    return { updated: await this.notifications.markAllRead(user.userId) };
  }

  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@CurrentUser() user: AuthUser, @Body() dto: DeviceTokenDto): Promise<void> {
    await this.notifications.registerDevice(user.userId, dto.token, dto.platform ?? 'android');
  }

  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(@CurrentUser() user: AuthUser, @Body() dto: DeviceTokenDto): Promise<void> {
    await this.notifications.unregisterDevice(user.userId, dto.token);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: PUSH_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): PushProvider =>
        config.get('PUSH_PROVIDER') === 'fcm'
          ? new FcmPushProvider(config.get('FIREBASE_SERVICE_ACCOUNT_BASE64')!)
          : new NoopPushProvider(),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
