import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VintedAccount } from './vinted-account.entity';
import { AccountsService } from './accounts.service';
import { VintedConnectService } from './vinted-connect.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([VintedAccount])],
  providers: [AccountsService, VintedConnectService],
  controllers: [AccountsController],
  exports: [AccountsService, VintedConnectService],
})
export class AccountsModule {}
