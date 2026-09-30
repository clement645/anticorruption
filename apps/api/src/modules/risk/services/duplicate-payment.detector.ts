import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import type { DetectionResult } from '../risk.types';
import type { EnvConfig } from '../../../config/env.validation';

/**
 * Explicitly deferred in Phase 8 ("duplicate-invoice detection explicitly
 * deferred to Phase 9, no Invoice entity exists yet") and built post-launch
 * now that Invoice/PurchaseOrder (Phase 9) exist. `Invoice.invoiceNumber` is
 * already `@unique` at the database level, so the naive case — the exact
 * same invoice number submitted twice — was already structurally
 * impossible before this detector existed. The real fraud pattern this
 * catches is different and more realistic: the SAME supplier submitting a
 * SECOND invoice at the IDENTICAL amount (under a different invoice
 * number) within a short window — either against the same purchase order
 * (classic double-billing) or a different one entirely (the same physical
 * delivery billed twice under two different authorizations).
 *
 * Pure detection only — see RiskAlertsService's own doc comment: this
 * engine has no code path that can block anything, only ever raises an
 * alert for a human with `risk:review` to act on. The actual HARD, blocking
 * control against over-invoicing — a purchase order's cumulative invoiced
 * amount must never exceed its authorized amount — lives directly in
 * InvoicesService.create(), the domain service that owns that invariant,
 * same pattern as AllocationsService's "cannot commit beyond available
 * balance" and the post-launch split-procurement approval gate.
 */
@Injectable()
export class DuplicatePaymentDetector {
  private readonly logger = new Logger(DuplicatePaymentDetector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskAlertsService: RiskAlertsService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async evaluateInvoice(invoiceId: string): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
      });
      if (!invoice) {
        return;
      }

      const windowDays = this.config.get('RISK_DUPLICATE_PAYMENT_WINDOW_DAYS', {
        infer: true,
      });
      const windowStart = new Date(
        Date.now() - windowDays * 24 * 60 * 60 * 1000,
      );

      const candidates = await this.prisma.invoice.findMany({
        where: {
          id: { not: invoice.id },
          supplierId: invoice.supplierId,
          amount: invoice.amount,
          status: { not: 'REJECTED' },
          createdAt: { gte: windowStart },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (candidates.length === 0) {
        return;
      }

      const samePurchaseOrder = candidates.filter(
        (c) => c.purchaseOrderId === invoice.purchaseOrderId,
      );

      // Same PO, same amount, same supplier, different invoice number —
      // there is no ordinary business reason to bill the identical amount
      // twice against one purchase order, so this is the higher-confidence
      // signal. A match against a DIFFERENT PO is still worth a look (could
      // be one delivery billed under two authorizations) but is more likely
      // to have an innocent explanation (e.g. genuinely identical recurring
      // charges), hence MEDIUM rather than HIGH.
      const severity = samePurchaseOrder.length > 0 ? 'HIGH' : 'MEDIUM';

      const result: DetectionResult = {
        severity,
        title: 'Possible duplicate payment',
        description:
          `This supplier has ${candidates.length} other invoice(s) at the identical ` +
          `amount ${invoice.amount.toString()} within the last ${windowDays} days` +
          (samePurchaseOrder.length > 0
            ? ', including against the SAME purchase order.'
            : ', against a different purchase order.'),
        evidence: {
          invoiceId: invoice.id,
          supplierId: invoice.supplierId,
          purchaseOrderId: invoice.purchaseOrderId,
          amount: invoice.amount.toString(),
          windowDays,
          matchingInvoiceIds: candidates.map((c) => c.id),
          samePurchaseOrderMatchIds: samePurchaseOrder.map((c) => c.id),
        },
      };

      await this.riskAlertsService.raiseAlert(
        'DUPLICATE_PAYMENT',
        'Invoice',
        invoice.id,
        result,
      );
    } catch (error) {
      this.logger.error(
        `Duplicate payment detection failed for invoice ${invoiceId}`,
        error,
      );
    }
  }
}
