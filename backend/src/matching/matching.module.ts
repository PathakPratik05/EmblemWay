import { Controller, Get, Global, Module, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import { RouteSegmentsService } from '../hotspots/route-segments.service';
import { MatchesQueryDto } from '../journeys/dto/journey.dto';
import { MatchingRepository } from './matching.repository';
import { MatchingService } from './matching.service';

@ApiTags('matching')
@ApiBearerAuth()
@Controller('journeys/:id')
export class MatchingController {
  constructor(
    private readonly matching: MatchingService,
    private readonly segments: RouteSegmentsService,
  ) {}

  @Get('matches')
  @ApiOperation({
    summary: 'Other travellers on the same or overlapping route (deduplicated per traveller)',
  })
  matches(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: MatchesQueryDto,
  ) {
    return this.matching.getMatches(id, user.userId, {
      vehicleTypeCodes: q.vehicleTypes,
      minOverlapRatio: q.minOverlap,
      matchTypes: q.matchTypes,
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  @Get('segments')
  @ApiOperation({ summary: 'Number of travellers on each stretch of this journey route' })
  segmentCounts(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.segments.segmentCounts(id, user.userId);
  }
}

@Global()
@Module({
  controllers: [MatchingController],
  providers: [MatchingService, MatchingRepository],
  exports: [MatchingService],
})
export class MatchingModule {}
