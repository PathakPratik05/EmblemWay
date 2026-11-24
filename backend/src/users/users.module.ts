import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta } from '../common/decorators/auth.decorators';
import { UpdatePreferencesDto, UpdateProfileDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() u: AuthUser) {
    return this.users.getMe(u.userId);
  }

  @Patch()
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(u.userId, dto);
  }

  @Patch('preferences')
  preferences(@CurrentUser() u: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.users.updatePreferences(u.userId, dto);
  }

  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  avatar(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.users.uploadAvatar(u.userId, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() u: AuthUser) {
    return this.users.removeAvatar(u.userId);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('export')
  @ApiOperation({ summary: 'Download all personal data held about the signed-in user' })
  export(@CurrentUser() u: AuthUser) {
    return this.users.exportData(u.userId);
  }

  @Get('sessions')
  sessions(@CurrentUser() u: AuthUser) {
    return this.users.listSessions(u.userId, u.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.users.revokeSession(u.userId, id);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete the account and all personal / location data' })
  async delete(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.users.deleteAccount(u.userId, { requestId: meta.requestId, ip: meta.ip });
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
