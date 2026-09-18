import { IsEnum } from 'class-validator';

export enum ReportStatusDto {
  UNDER_REVIEW = 'UNDER_REVIEW',
  SUBSTANTIATED = 'SUBSTANTIATED',
  UNSUBSTANTIATED = 'UNSUBSTANTIATED',
}

export class ChangeStatusDto {
  @IsEnum(ReportStatusDto)
  status!: ReportStatusDto;
}
