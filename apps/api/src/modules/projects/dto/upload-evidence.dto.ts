import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UploadEvidenceDto {
  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsString()
  @MinLength(1)
  mimeType!: string;

  /** Base64-encoded file content. Encrypted at rest and stored for real — see schema.prisma comment on ProjectEvidence. */
  @IsString()
  @MinLength(1)
  fileContentBase64!: string;

  @IsOptional()
  @IsUUID()
  inspectionId?: string;
}
