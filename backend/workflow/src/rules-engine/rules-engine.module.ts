import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ApprovalRule } from './entities/approval-rule.entity';
import { User } from '../users/entities/user.entity';
import { RulesEngineService } from './rules-engine.service';

@Module({
  imports: [SequelizeModule.forFeature([ApprovalRule, User])],
  providers: [RulesEngineService],
  exports: [RulesEngineService],
})
export class RulesEngineModule {}
