import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { SellerListing } from './seller-listing.entity';
import { Sale } from './sale.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { InventoryService } from './inventory.service';
import { InventorySyncService } from './inventory-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, SellerListing, Sale]), AccountsModule],
  providers: [InventoryService, InventorySyncService],
  controllers: [],
  exports: [InventoryService, InventorySyncService],
})
export class InventoryModule {}
