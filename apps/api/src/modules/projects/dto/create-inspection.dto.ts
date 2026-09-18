import { IsEnum, IsString, MinLength } from 'class-validator';

export enum InspectionOutcomeDto {
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  NEEDS_REVISION = 'NEEDS_REVISION',
}

export class CreateInspectionDto {
  @IsEnum(InspectionOutcomeDto)
  outcome!: InspectionOutcomeDto;

  @IsString()
  @MinLength(1)
  findings!: string;
}
