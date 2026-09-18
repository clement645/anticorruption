import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateTenderLotDto {
  @IsString()
  @MinLength(1)
  lotNumber!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @IsPositive()
  estimatedAmount!: number;
}

export class CreateTenderDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsDateString()
  closingDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTenderLotDto)
  lots!: CreateTenderLotDto[];
}
