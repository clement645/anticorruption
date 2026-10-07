import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangeForcedPasswordDto {
  @IsString()
  changeToken!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(256)
  newPassword!: string;
}
