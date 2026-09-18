import {
  IsDateString,
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateMilestoneDto {
  @IsInt()
  @IsPositive()
  sequenceNumber!: number;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @IsPositive()
  plannedAmount!: number;

  @IsDateString()
  plannedDate!: string;
}
