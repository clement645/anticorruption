import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateFiscalYearDto {
  @IsString()
  @MinLength(1)
  name!: string; // e.g. "2026/2027"

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
