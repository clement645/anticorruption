import { IsString, MinLength } from 'class-validator';

export class AddEvidenceDto {
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
