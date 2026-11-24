import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { MaintenanceService } from './maintenance.service';

@Global()
@Module({
  providers: [JobsService, MaintenanceService],
  exports: [JobsService, MaintenanceService],
})
export class JobsModule {}
