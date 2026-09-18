import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreatePurchaseOrderDto {
  @IsString()
  @MinLength(1)
  poNumber!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
