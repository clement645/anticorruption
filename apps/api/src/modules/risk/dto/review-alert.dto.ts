import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReviewAlertStatusDto {
  UNDER_REVIEW = 'UNDER_REVIEW',
  CONFIRMED = 'CONFIRMED',
  DISMISSED = 'DISMISSED',
}

export class ReviewAlertDto {
  @IsEnum(ReviewAlertStatusDto)
  status!: ReviewAlertStatusDto;

  @IsOptional()
  @IsString()
  notes?: string;
}
