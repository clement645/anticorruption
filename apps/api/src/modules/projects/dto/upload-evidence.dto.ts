import {
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

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

  /**
   * GPS-tagged evidence capture (post-launch): best-effort, client-supplied
   * (a browser/mobile Geolocation API reading at capture time), never
   * server-derived. `latitude`/`longitude` must be supplied together or not
   * at all — enforced in EvidenceService, not here, since class-validator
   * has no built-in "both or neither" cross-field rule.
   */
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  gpsAccuracyMeters?: number;

  /** The DEVICE's capture timestamp — distinct from the server's upload time. */
  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}
