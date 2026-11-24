import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import {
  CancelJourneyDto,
  CreateJourneyDto,
  ListJourneysQueryDto,
  UpdateJourneyDto,
} from './dto/journey.dto';
import { JourneysRepository } from './journeys.repository';
import { JourneysService } from './journeys.service';

@ApiTags('journeys')
@ApiBearerAuth()
@Controller('journeys')
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Client-generated key; retries with the same key return the original journey',
  })
  @ApiOperation({
    summary: 'Register a journey (route is generated and stored; matching runs in the background)',
  })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateJourneyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { journey, replayed } = await this.journeys.create(user.userId, dto, idempotencyKey);
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return journey;
  }

  @Get()
  @ApiOperation({
    summary:
      "The signed-in user's journeys: upcoming, history (completed/cancelled/expired) or drafts",
  })
  list(@CurrentUser() user: AuthUser, @Query() q: ListJourneysQueryDto) {
    return this.journeys.list(user.userId, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journeys.getForUser(id, user.userId);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit an upcoming journey (requires current version; route is recalculated if places change)',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJourneyDto,
  ) {
    return this.journeys.update(user.userId, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelJourneyDto,
  ) {
    return this.journeys.transition(user.userId, id, 'cancel', dto.reason);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journeys.transition(user.userId, id, 'publish');
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journeys.transition(user.userId, id, 'start');
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journeys.transition(user.userId, id, 'complete');
  }
}

@Module({
  controllers: [JourneysController],
  providers: [JourneysService, JourneysRepository],
  exports: [JourneysService],
})
export class JourneysModule {}
