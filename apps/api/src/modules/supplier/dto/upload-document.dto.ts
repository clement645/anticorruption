import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export enum SupplierDocumentTypeDto {
  REGISTRATION_CERTIFICATE = 'REGISTRATION_CERTIFICATE',
  TAX_COMPLIANCE_CERTIFICATE = 'TAX_COMPLIANCE_CERTIFICATE',
  CR12 = 'CR12',
  PIN_CERTIFICATE = 'PIN_CERTIFICATE',
  OTHER = 'OTHER',
}

export class UploadDocumentDto {
  @IsEnum(SupplierDocumentTypeDto)
  documentType!: SupplierDocumentTypeDto;

  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsString()
  @MinLength(1)
  mimeType!: string;

  /** Base64-encoded file content. Only its SHA-256 hash and size are persisted — see schema.prisma comment on SupplierDocument. */
  @IsString()
  @MinLength(1)
  fileContentBase64!: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
