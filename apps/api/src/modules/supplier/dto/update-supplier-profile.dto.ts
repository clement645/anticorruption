import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export enum SupplierBusinessTypeDto {
  SOLE_PROPRIETORSHIP = 'SOLE_PROPRIETORSHIP',
  PARTNERSHIP = 'PARTNERSHIP',
  LIMITED_COMPANY = 'LIMITED_COMPANY',
  COOPERATIVE = 'COOPERATIVE',
  NGO = 'NGO',
  OTHER = 'OTHER',
}

export class UpdateSupplierProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(SupplierBusinessTypeDto)
  businessType?: SupplierBusinessTypeDto;

  @IsOptional()
  @IsString()
  taxIdentifier?: string;

  @IsOptional()
  @IsString()
  physicalAddress?: string;

  @IsOptional()
  @IsString()
  county?: string;

  @IsOptional()
  @IsString()
  contactPersonName?: string;
}
