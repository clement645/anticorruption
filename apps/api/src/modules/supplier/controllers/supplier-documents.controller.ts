import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SupplierDocumentsService } from '../services/supplier-documents.service';
import { UploadDocumentDto } from '../dto/upload-document.dto';
import { RejectDocumentDto } from '../dto/reject-document.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('supplier')
@Controller('suppliers')
export class SupplierDocumentsController {
  constructor(private readonly documentsService: SupplierDocumentsService) {}

  @Get(':id/documents')
  @RequirePermissions('supplier:read_sensitive')
  list(@Param('id') id: string) {
    return this.documentsService.list(id);
  }

  @Post(':id/documents')
  @RequirePermissions('supplier:manage')
  upload(
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.documentsService.upload(id, dto, actor, meta(req));
  }
}

@ApiTags('supplier')
@Controller('supplier-documents')
export class SupplierDocumentVerificationController {
  constructor(private readonly documentsService: SupplierDocumentsService) {}

  @Post(':documentId/verify')
  @RequirePermissions('supplier:verify')
  verify(
    @Param('documentId') documentId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.documentsService.verify(documentId, actor, meta(req));
  }

  @Post(':documentId/reject')
  @RequirePermissions('supplier:verify')
  reject(
    @Param('documentId') documentId: string,
    @Body() dto: RejectDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.documentsService.reject(documentId, dto, actor, meta(req));
  }
}
