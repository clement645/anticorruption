import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateCommitmentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  description!: string;
}
