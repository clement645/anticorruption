import {
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @IsUUID()
  contractId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsString()
  location?: string;

  /** Known site coordinates (post-launch, GPS-tagged evidence capture) — manually supplied, never geocoded. */
  @IsOptional()
  @IsLatitude()
  siteLatitude?: number;

  @IsOptional()
  @IsLongitude()
  siteLongitude?: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  plannedEndDate!: string;
}
