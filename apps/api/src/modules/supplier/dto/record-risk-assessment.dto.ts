import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum SupplierRiskLevelDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export class RecordRiskAssessmentDto {
  @IsEnum(SupplierRiskLevelDto)
  riskLevel!: SupplierRiskLevelDto;

  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  /** Free-form structured reasons (detector-agnostic — see schema.prisma comment on SupplierRiskProfile). */
  @IsArray()
  factors!: unknown[];

  @IsOptional()
  @IsString()
  notes?: string;
}
