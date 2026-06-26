import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VintedAccount } from './vinted-account.entity';
import { AccountsService } from './accounts.service';

@Module({
  imports: [TypeOrmModule.forFeature([VintedAccount])],
  providers: [AccountsService],
  controllers: [],
  exports: [AccountsService],
})
export class AccountsModule {}
