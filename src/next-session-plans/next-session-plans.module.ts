import { Module } from '@nestjs/common';
import { NextSessionPlansService } from './next-session-plans.service';
import { NextSessionPlansController } from './next-session-plans.controller';

@Module({
  controllers: [NextSessionPlansController],
  providers: [NextSessionPlansService],
  exports: [NextSessionPlansService],
})
export class NextSessionPlansModule {}
