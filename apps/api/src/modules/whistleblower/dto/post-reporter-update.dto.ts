import { IsString, MinLength } from 'class-validator';

export class PostReporterUpdateDto {
  @IsString()
  @MinLength(1)
  message!: string;
}
