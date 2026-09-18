import { IsString, Length } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  mfaToken!: string;

  // 6 digits for a TOTP code, or "XXXX-XXXX-XXXX" (14 chars) for a backup code.
  @IsString()
  @Length(6, 14)
  code!: string;
}
