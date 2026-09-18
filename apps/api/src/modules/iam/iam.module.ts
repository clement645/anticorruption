import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import type { EnvConfig } from '../../config/env.validation';
import { AuthService } from './services/auth.service';
import { UsersService } from './services/users.service';
import { TokenService } from './services/token.service';
import { MfaService } from './services/mfa.service';
import { RolesService } from './services/roles.service';
import { OrganizationsService } from './services/organizations.service';
import { SecurityEventsService } from './services/security-events.service';
import { AuthController } from './controllers/auth.controller';
import { UsersController } from './controllers/users.controller';
import { RolesController } from './controllers/roles.controller';
import { OrganizationsController } from './controllers/organizations.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
    AuditModule,
  ],
  controllers: [
    AuthController,
    UsersController,
    RolesController,
    OrganizationsController,
  ],
  providers: [
    AuthService,
    UsersService,
    TokenService,
    MfaService,
    RolesService,
    OrganizationsService,
    SecurityEventsService,
    JwtStrategy,
    // Registered globally so every route requires authentication (Zero
    // Trust) and declared permissions are enforced, without every module
    // having to remember to attach the guards itself.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [UsersService, SecurityEventsService],
})
export class IamModule {}
