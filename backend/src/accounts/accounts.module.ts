import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VintedAccount } from './vinted-account.entity';
import { AccountsService } from './accounts.service';
import { VintedConnectService } from './vinted-connect.service';

@Module({
  imports: [TypeOrmModule.forFeature([VintedAccount])],
  providers: [AccountsService, VintedConnectService],
  controllers: [],
  exports: [AccountsService, VintedConnectService],
})
export class AccountsModule {}
