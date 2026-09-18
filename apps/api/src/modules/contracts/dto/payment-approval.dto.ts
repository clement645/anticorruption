import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum PaymentApprovalDecisionDto {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class PaymentApprovalDto {
  @IsEnum(PaymentApprovalDecisionDto)
  decision!: PaymentApprovalDecisionDto;

  @IsOptional()
  @IsString()
  notes?: string;
}
