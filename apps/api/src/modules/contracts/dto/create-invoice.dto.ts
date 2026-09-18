import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateInvoiceItemDto {
  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class CreateInvoiceDto {
  @IsString()
  @MinLength(1)
  invoiceNumber!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items!: CreateInvoiceItemDto[];
}
