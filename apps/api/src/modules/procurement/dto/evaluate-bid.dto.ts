import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class EvaluateBidDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  technicalScore!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  financialScore!: number;

  @IsOptional()
  @IsString()
  comments?: string;
}
