import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum ReconciliationStatusDto {
  MATCHED = 'MATCHED',
  DISCREPANCY = 'DISCREPANCY',
}

export class RecordReconciliationDto {
  @IsString()
  @MinLength(1)
  externalReference!: string;

  @IsEnum(ReconciliationStatusDto)
  status!: ReconciliationStatusDto;

  @IsOptional()
  @IsString()
  notes?: string;
}
