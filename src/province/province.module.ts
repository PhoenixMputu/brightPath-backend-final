import { Module } from '@nestjs/common';
import { ProvinceController } from './province.controller.js';
import { ProvinceService } from './province.service.js';

@Module({
  controllers: [ProvinceController],
  providers: [ProvinceService],
})
export class ProvinceModule {}
