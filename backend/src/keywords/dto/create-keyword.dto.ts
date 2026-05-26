import { IsString, IsOptional, IsNumber, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateKeywordDto {
  @IsString()
  label: string;

  @IsString()
  search_text: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  max_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  target_margin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shipping_estimate?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  catalog_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(30)
  @Max(3600)
  scan_interval_seconds?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
