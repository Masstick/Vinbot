import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { SellerListing } from './seller-listing.entity';
import { Sale } from './sale.entity';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product, SellerListing, Sale]), AccountsModule],
  providers: [],
  controllers: [],
  exports: [],
})
export class InventoryModule {}
