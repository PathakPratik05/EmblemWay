import { Controller, Get, Global, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/auth.decorators';
import { CitiesService } from './cities.service';

@ApiTags('cities')
@Controller('cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Public()
  @Get()
  async list() {
    return (await this.cities.listActive()).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      state: c.state,
      timezone: c.timezone,
      center: { latitude: c.centerLatitude, longitude: c.centerLongitude },
      radiusMeters: c.radiusMeters,
    }));
  }
}

@Global()
@Module({
  controllers: [CitiesController],
  providers: [CitiesService],
  exports: [CitiesService],
})
export class CitiesModule {}
