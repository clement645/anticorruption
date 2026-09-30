import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { StepUpService } from '../services/step-up.service';
import { LoginDto } from '../dto/login.dto';
import { VerifyMfaDto } from '../dto/verify-mfa.dto';
import { StepUpDto } from '../dto/step-up.dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { EnvConfig } from '../../../config/env.validation';
import type { IssuedTokens } from '../services/token.service';
import type { AuthenticatedUser } from '../types/jwt-payload.type';

const REFRESH_COOKIE_NAME = 'bpfmps_refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly stepUpService: StepUpService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(
      dto.email,
      dto.password,
      this.requestMeta(req),
    );

    if (result.status === 'mfa_required') {
      return { mfaRequired: true, mfaToken: result.mfaToken };
    }

    this.setRefreshCookie(res, result.tokens);
    return this.toLoginResponse(result.tokens);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Body() dto: VerifyMfaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.verifyMfaAndLogin(
      dto.mfaToken,
      dto.code,
      this.requestMeta(req),
    );
    this.setRefreshCookie(res, tokens);
    return this.toLoginResponse(tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    if (!presented) {
      this.clearRefreshCookie(res);
      return { accessToken: null };
    }
    const tokens = await this.authService.refresh(
      presented,
      this.requestMeta(req),
    );
    this.setRefreshCookie(res, tokens);
    return this.toLoginResponse(tokens);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const presented = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    await this.authService.logout(presented);
    this.clearRefreshCookie(res);
  }

  /**
   * Step-up MFA (post-launch): requires an already-valid access token (not
   * @Public()) plus a FRESH TOTP/backup code, and issues a short-lived
   * assertion (`STEP_UP_TOKEN_TTL_SECONDS`, default 10 minutes) usable via
   * the `X-Step-Up-Token` header on routes decorated with
   * @RequireStepUp() — see StepUpGuard.
   */
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  async stepUp(@Body() dto: StepUpDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stepUpService.verifyAndIssue(user.sub, dto.code);
  }

  private toLoginResponse(tokens: IssuedTokens) {
    return {
      accessToken: tokens.accessToken,
      expiresIn: this.config.get('JWT_ACCESS_TOKEN_TTL_SECONDS', {
        infer: true,
      }),
    };
  }

  private requestMeta(req: Request) {
    return {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  private cookieOptions(): CookieOptions {
    const isProduction =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
    };
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
      ...this.cookieOptions(),
      expires: tokens.refreshTokenExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }
}
