import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreatePlanDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  fiscalYearId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
