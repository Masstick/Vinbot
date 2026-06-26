import { IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetPurchasePriceDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  purchase_price: number | null;
}
