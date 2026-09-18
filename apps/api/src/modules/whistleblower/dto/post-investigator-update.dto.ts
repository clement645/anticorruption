import { IsString, MinLength } from 'class-validator';

export class PostInvestigatorUpdateDto {
  @IsString()
  @MinLength(1)
  message!: string;
}
