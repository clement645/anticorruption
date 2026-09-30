import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NOTIFICATION_ADAPTER } from './notifications.constants';
import { LogOnlyNotificationAdapter } from './log-only-notification.adapter';
import { NotificationsService } from './notifications.service';

/**
 * Global so NOTIFICATION_ADAPTER and NotificationsService are injectable
 * from any module (RiskModule, WhistleblowerModule) without each needing
 * to import NotificationsModule directly — mirrors BlockchainModule/
 * StorageModule's own rationale exactly (see blockchain.module.ts).
 */
@Global()
@Module({
  imports: [AuditModule],
  providers: [
    { provide: NOTIFICATION_ADAPTER, useClass: LogOnlyNotificationAdapter },
    NotificationsService,
  ],
  exports: [NOTIFICATION_ADAPTER, NotificationsService],
})
export class NotificationsModule {}
