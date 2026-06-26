import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VintedAccount } from './vinted-account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([VintedAccount])],
  providers: [],
  controllers: [],
  exports: [],
})
export class AccountsModule {}
