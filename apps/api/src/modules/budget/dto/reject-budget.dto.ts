import { IsOptional, IsString } from 'class-validator';

export class RejectBudgetDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
