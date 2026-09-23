import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SpecialtyRecordsController } from './specialty-records.controller';
import { SpecialtyRecordsService } from './specialty-records.service';

@Module({
  imports: [PrismaModule],
  controllers: [SpecialtyRecordsController],
  providers: [SpecialtyRecordsService],
  exports: [SpecialtyRecordsService],
})
export class SpecialtyRecordsModule {}
