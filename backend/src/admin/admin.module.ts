import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { JourneyStatus, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AuthUser,
  CurrentUser,
  ReqMeta,
  RequestMeta,
  Roles,
} from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import { PaginationQueryDto } from '../common/pagination/pagination';
import { AuditService } from '../audit/audit.service';
import { HealthModule, HealthService } from '../health/health.module';
import { HotspotQueryDto, toHotspotQuery } from '../hotspots/hotspots.module';
import { HotspotsService } from '../hotspots/hotspots.service';
import { JourneysModule } from '../journeys/journeys.module';
import { JourneysService } from '../journeys/journeys.service';
import { MaintenanceService } from '../jobs/maintenance.service';
import { SettingsService } from '../settings/settings.service';
import { SETTINGS_KEYS, SettingsKey } from '../settings/settings.schema';
import { AdminService } from './admin.service';

class AdminUsersQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}

class AdminJourneysQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: JourneyStatus })
  @IsOptional()
  @IsEnum(JourneyStatus)
  status?: JourneyStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) vehicleType?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

class AuditQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
}

class DaysQuery {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30;
  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;
}

class UserStatusDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsIn(['ACTIVE', 'SUSPENDED']) status!:
    | 'ACTIVE'
    | 'SUSPENDED';
}

class CancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** Every route here requires ADMIN (or SUPER_ADMIN). Ordinary mobile users get 403. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly settings: SettingsService,
    private readonly hotspots: HotspotsService,
    private readonly journeys: JourneysService,
    private readonly maintenance: MaintenanceService,
    private readonly health: HealthService,
    private readonly audit: AuditService,
  ) {}

  @Get('stats/overview') overview() {
    return this.admin.overview();
  }

  @Get('stats/daily') daily(@Query() q: DaysQuery) {
    return this.admin.journeysPerDay(q.days);
  }

  @Get('stats/vehicles') vehicles() {
    return this.admin.vehicleStats();
  }

  @Get('stats/cities') cities() {
    return this.admin.cityStats();
  }

  @Get('stats/popular-routes') popular(@Query() q: DaysQuery) {
    return this.admin.popularRoutes(q.limit, q.days);
  }

  @Get('stats/traffic') traffic() {
    return this.admin.trafficStats();
  }

  @Get('hotspots') heatmap(@Query() q: HotspotQueryDto) {
    return this.hotspots.query(toHotspotQuery(q));
  }

  @Get('hotspots/hourly') hourly(@Query() q: HotspotQueryDto) {
    return this.hotspots.hourlyProfile(toHotspotQuery(q));
  }

  @Get('users') users(@Query() q: AdminUsersQuery) {
    return this.admin.listUsers(q);
  }

  @Patch('users/:id/status')
  setStatus(
    @CurrentUser() u: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserStatusDto,
  ) {
    return this.admin.setUserStatus(
      { userId: u.userId, role: u.role, requestId: meta.requestId, ip: meta.ip },
      id,
      dto.status,
    );
  }

  @Get('journeys') listJourneys(@Query() q: AdminJourneysQuery) {
    return this.admin.listJourneys(q);
  }

  @Post('journeys/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelJourney(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ) {
    await this.journeys.transition(null, id, 'cancel', dto.reason ?? 'Cancelled by administrator');
    await this.audit.record({
      action: 'admin.journey_cancelled',
      actorUserId: u.userId,
      actorRole: u.role,
      entityType: 'journey',
      entityId: id,
    });
    return { id, status: 'CANCELLED' };
  }

  @Get('settings') getSettings() {
    return this.settings.getAll();
  }

  @Patch('settings/:key')
  async updateSettings(
    @CurrentUser() u: AuthUser,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (!SETTINGS_KEYS.includes(key as SettingsKey)) throw AppError.notFound('Settings section');
    const updated = await this.settings.update(key as SettingsKey, body, u.userId);
    await this.audit.record({
      action: 'admin.settings_updated',
      actorUserId: u.userId,
      actorRole: u.role,
      entityType: 'settings',
      entityId: key,
      metadata: body,
    });
    return updated;
  }

  @Get('audit-logs') auditLogs(@Query() q: AuditQuery) {
    return this.admin.auditLogs(q);
  }

  @Get('health') healthDetails() {
    return this.health.details();
  }

  @Roles('SUPER_ADMIN')
  @Post('maintenance/:task')
  @HttpCode(HttpStatus.OK)
  async runTask(@CurrentUser() u: AuthUser, @Param('task') task: string) {
    let result: unknown;
    switch (task) {
      case 'expire-journeys':
        result = await this.maintenance.expireStaleJourneys();
        break;
      case 'auto-complete':
        result = await this.maintenance.autoCompleteJourneys();
        break;
      case 'aggregate-hotspots':
        result = await this.maintenance.aggregateHotspots();
        break;
      case 'retention':
        result = await this.maintenance.applyRetention();
        break;
      default:
        throw AppError.notFound('Maintenance task');
    }
    await this.audit.record({
      action: 'admin.maintenance_run',
      actorUserId: u.userId,
      actorRole: u.role,
      entityType: 'task',
      entityId: task,
    });
    return { task, result };
  }
}

@Module({
  imports: [HealthModule, JourneysModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
