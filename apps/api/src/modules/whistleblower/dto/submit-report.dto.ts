import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ReportCategoryDto {
  CORRUPTION = 'CORRUPTION',
  FRAUD = 'FRAUD',
  PROCUREMENT_IRREGULARITY = 'PROCUREMENT_IRREGULARITY',
  CONFLICT_OF_INTEREST = 'CONFLICT_OF_INTEREST',
  ABUSE_OF_OFFICE = 'ABUSE_OF_OFFICE',
  OTHER = 'OTHER',
}

export class ReportEvidenceInputDto {
  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsString()
  @MinLength(1)
  mimeType!: string;

  @IsString()
  @MinLength(1)
  fileContentBase64!: string;
}

export class SubmitReportDto {
  @IsEnum(ReportCategoryDto)
  category!: ReportCategoryDto;

  @IsString()
  @MinLength(10)
  description!: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  // Free text, not IsEmail-only — a reporter may prefer to leave a phone
  // number instead. Deliberately optional everywhere in this module: the
  // portal must work end-to-end for a reporter who provides absolutely
  // nothing beyond the report itself.
  @IsOptional()
  @IsString()
  @MinLength(3)
  contact?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportEvidenceInputDto)
  evidence?: ReportEvidenceInputDto[];
}
