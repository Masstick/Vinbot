import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, HttpCode, ValidationPipe } from '@nestjs/common';
import { InventoryService, InventoryFilters } from './inventory.service';
import { InventorySyncService } from './inventory-sync.service';
import { SetPurchasePriceDto } from './dto/set-purchase-price.dto';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly sync: InventorySyncService,
  ) {}

  @Get()
  list(
    @Query('brand') brand?: string,
    @Query('size') size?: string,
    @Query('category') category?: string,
    @Query('price_min') priceMin?: string,
    @Query('price_max') priceMax?: string,
  ) {
    const filters: InventoryFilters = {
      brand: brand || undefined,
      size: size || undefined,
      category: category || undefined,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
    };
    return this.inventory.listInventory(filters);
  }

  @Get('sales')
  sales() {
    return this.inventory.listSales();
  }

  @Patch('products/:id/purchase-price')
  @HttpCode(204)
  async setPurchasePrice(
    @Param('id', ParseIntPipe) id: number,
    @Body(ValidationPipe) dto: SetPurchasePriceDto,
  ) {
    await this.inventory.setPurchasePrice(id, dto.purchase_price ?? null);
  }

  @Post('sync')
  syncNow() {
    return this.sync.syncNow();
  }
}
