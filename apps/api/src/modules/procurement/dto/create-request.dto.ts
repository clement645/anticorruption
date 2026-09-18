import {
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateRequestDto {
  @IsUUID()
  procurementPlanId!: string;

  @IsUUID()
  organizationId!: string;

  @IsUUID()
  allocationId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @IsPositive()
  estimatedAmount!: number;
}
