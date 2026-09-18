import {
  IsEnum,
  IsNumber,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export enum BudgetAdjustmentTypeDto {
  INCREASE = 'INCREASE',
  DECREASE = 'DECREASE',
}

export class CreateAdjustmentDto {
  @IsEnum(BudgetAdjustmentTypeDto)
  type!: BudgetAdjustmentTypeDto;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}
