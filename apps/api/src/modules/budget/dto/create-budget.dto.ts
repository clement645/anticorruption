import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateBudgetLineDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  voteCode!: string;

  @IsString()
  @MinLength(1)
  voteName!: string;

  @IsString()
  @MinLength(1)
  programName!: string;

  @IsOptional()
  @IsString()
  subProgramName?: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @IsPositive()
  authorizedAmount!: number;
}

export class CreateBudgetDto {
  @IsUUID()
  fiscalYearId!: string;

  @IsUUID()
  organizationId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBudgetLineDto)
  lines!: CreateBudgetLineDto[];
}
