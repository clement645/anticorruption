import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateExpenditureDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  description!: string;
}
