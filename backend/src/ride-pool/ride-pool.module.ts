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
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import { RidePoolService } from './ride-pool.service';

class CreateOfferDto {
  @ApiProperty({ minimum: 1, maximum: 50 }) @IsInt() @Min(1) @Max(50) totalSeats!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(280) notes?: string;
}

class SeatRequestDto {
  @ApiProperty({ description: 'Your upcoming journey that matches this ride' })
  @IsUUID()
  journeyId!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(10) seats?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(280) message?: string;
}

@ApiTags('ride-pool')
@ApiBearerAuth()
@Controller()
export class RidePoolController {
  constructor(private readonly pool: RidePoolService) {}

  @Post('journeys/:id/ride-pool/offer')
  offer(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOfferDto,
  ) {
    return this.pool.createOffer(u.userId, id, dto.totalSeats, dto.notes);
  }

  @Get('ride-pool/offers/mine')
  myOffers(@CurrentUser() u: AuthUser) {
    return this.pool.myOffers(u.userId);
  }

  @Get('ride-pool/requests/mine')
  myRequests(@CurrentUser() u: AuthUser) {
    return this.pool.myRequests(u.userId);
  }

  @Get('ride-pool/offers/:offerId')
  getOffer(@CurrentUser() u: AuthUser, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.pool.getOffer(u.userId, offerId);
  }

  @Delete('ride-pool/offers/:offerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelOffer(
    @CurrentUser() u: AuthUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ): Promise<void> {
    await this.pool.cancelOffer(u.userId, offerId);
  }

  @Post('ride-pool/offers/:offerId/requests')
  request(
    @CurrentUser() u: AuthUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: SeatRequestDto,
  ) {
    return this.pool.requestSeat(u.userId, offerId, dto.journeyId, dto.seats ?? 1, dto.message);
  }

  @Post('ride-pool/requests/:requestId/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() u: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.pool.decide(u.userId, requestId, 'ACCEPT');
  }

  @Post('ride-pool/requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() u: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.pool.decide(u.userId, requestId, 'REJECT');
  }

  @Post('ride-pool/requests/:requestId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentUser() u: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.pool.withdraw(u.userId, requestId);
  }
}

@Global()
@Module({
  controllers: [RidePoolController],
  providers: [RidePoolService],
  exports: [RidePoolService],
})
export class RidePoolModule {}
