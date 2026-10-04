import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [PrismaModule],
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
