import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { CreateUserVehicleDto, UpdateUserVehicleDto } from './vehicles.dto';
import { VehiclesService } from './vehicles.service';

@ApiTags('vehicles')
@Controller()
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Public()
  @Get('vehicle-types')
  listTypes() {
    return this.vehicles.listTypes();
  }

  @ApiBearerAuth()
  @Get('users/me/vehicles')
  list(@CurrentUser() user: AuthUser) {
    return this.vehicles.listUserVehicles(user.userId);
  }

  @ApiBearerAuth()
  @Post('users/me/vehicles')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserVehicleDto) {
    return this.vehicles.createUserVehicle(user.userId, dto);
  }

  @ApiBearerAuth()
  @Patch('users/me/vehicles/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserVehicleDto,
  ) {
    return this.vehicles.updateUserVehicle(user.userId, id, dto);
  }

  @ApiBearerAuth()
  @Delete('users/me/vehicles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.vehicles.deleteUserVehicle(user.userId, id);
  }
}
