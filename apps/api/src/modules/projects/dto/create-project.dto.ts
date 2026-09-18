import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @IsUUID()
  contractId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  plannedEndDate!: string;
}
