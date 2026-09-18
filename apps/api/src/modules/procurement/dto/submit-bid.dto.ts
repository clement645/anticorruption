import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class SubmitBidDto {
  @IsUUID()
  supplierId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
