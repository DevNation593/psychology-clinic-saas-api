import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FakturClient } from './faktur.client';

@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [BillingService, FakturClient],
  exports: [BillingService],
})
export class BillingModule {}
