import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class AddOwnerDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsString()
  @MinLength(1)
  nationalIdOrPassport!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercentage!: number;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsBoolean()
  isPoliticallyExposedPerson?: boolean;
}
