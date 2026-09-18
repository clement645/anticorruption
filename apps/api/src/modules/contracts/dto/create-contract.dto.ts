import {
  IsDateString,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateContractDto {
  @IsUUID()
  awardId!: string;

  @IsString()
  @MinLength(1)
  contractNumber!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsNumber()
  @IsPositive()
  value!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
