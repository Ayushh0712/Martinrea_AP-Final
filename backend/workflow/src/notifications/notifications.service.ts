import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  ApprovalEmailParams,
  renderApprovalRequiredHtml,
  renderApprovalRequiredText,
} from './templates/approval-required.template';

export interface SendApprovalRequiredInput {
  to: string;
  approverName: string;
  invoiceNumber: string;
  supplierName: string;
  totalAmount: number;
  currency: string;
  invoiceId: string;
  isEscalation: boolean;
}

/**
 * WF-04 / WF-05 - SMTP-backed notification service.
 *
 * Local dev: send to Mailpit (docker-compose, port 1025, web UI on 8025).
 * Staging / Prod: switch SMTP_HOST/USER/PASSWORD env vars to real SMTP
 * relay or Azure Communication Services.
 *
 * If MAIL_ENABLED=false the service no-ops and logs - useful for unit
 * tests and environments without SMTP access.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: Transporter | null = null;
  private enabled = false;
  private from = '';
  private appBaseUrl = '';
  private slaHours = 48;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.enabled = this.config.get<boolean>('mail.enabled') ?? false;
    this.from = this.config.get<string>('mail.from') ?? '';
    this.appBaseUrl = this.config.get<string>('app.baseUrl') ?? '';
    this.slaHours = this.config.get<number>('workflow.slaPendingApprovalHours') ?? 48;

    if (!this.enabled) {
      this.logger.warn('MAIL_ENABLED=false - notifications will be logged but not sent');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('mail.host'),
      port: this.config.get<number>('mail.port'),
      secure: this.config.get<boolean>('mail.secure'),
      auth: this.config.get<string>('mail.user')
        ? {
            user: this.config.get<string>('mail.user'),
            pass: this.config.get<string>('mail.password'),
          }
        : undefined,
    });
    this.logger.log(
      `Notifications enabled via ${this.config.get<string>('mail.host')}:${this.config.get<number>('mail.port')}`,
    );
  }

  async sendApprovalRequired(input: SendApprovalRequiredInput): Promise<void> {
    const params: ApprovalEmailParams = {
      approverName: input.approverName,
      invoiceNumber: input.invoiceNumber,
      supplierName: input.supplierName,
      totalAmount: input.totalAmount,
      currency: input.currency,
      approvalUrl: `${this.appBaseUrl}/invoices/${input.invoiceId}/review`,
      isEscalation: input.isEscalation,
      slaHours: this.slaHours,
    };

    const subject = input.isEscalation
      ? `[ESCALATION] Invoice ${input.invoiceNumber} pending your approval (${this.slaHours}h SLA breach)`
      : `Approval required: Invoice ${input.invoiceNumber} - ${input.supplierName}`;

    if (!this.enabled || !this.transporter) {
      this.logger.log(
        `[mail-disabled] would send to ${input.to}: "${subject}"`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject,
      text: renderApprovalRequiredText(params),
      html: renderApprovalRequiredHtml(params),
    });
    this.logger.log(`Sent approval email to ${input.to} (invoice ${input.invoiceNumber})`);
  }
}
