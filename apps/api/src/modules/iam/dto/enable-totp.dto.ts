import { IsString, Length } from 'class-validator';

export class EnableTotpDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
