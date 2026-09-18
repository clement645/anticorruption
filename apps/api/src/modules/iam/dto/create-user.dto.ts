import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ArrayNotEmpty,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  // Set directly by an administrator for this prototype — no email delivery
  // infrastructure exists yet to support an invite-link flow. The created
  // user is expected to change it after first login (not yet enforced; see
  // IMPLEMENTATION_PLAN.md Phase 2 follow-ups).
  @IsString()
  @MinLength(12)
  temporaryPassword!: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  roleIds!: string[];
}
