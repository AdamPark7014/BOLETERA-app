import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';

/**
 * CFDI 4.0 sandbox timbrado — produces deterministic fake UUID/XML for local/dev.
 * Swap pacProvider integration when a real PAC is configured.
 */
@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService
  ) {}

  async upsertFiscalProfile(
    orgId: string,
    data: {
      rfc: string;
      legalName: string;
      regimenFiscal?: string;
      codigoPostal: string;
      serie?: string;
      pacMode?: string;
      pacProvider?: string;
      pacApiKey?: string;
    }
  ) {
    return this.prisma.fiscalProfile.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        rfc: data.rfc.toUpperCase(),
        legalName: data.legalName,
        regimenFiscal: data.regimenFiscal ?? '601',
        codigoPostal: data.codigoPostal,
        serie: data.serie ?? 'A',
        pacMode: data.pacMode ?? 'sandbox',
        pacProvider: data.pacProvider,
        pacApiKey: data.pacApiKey,
      },
      update: {
        rfc: data.rfc.toUpperCase(),
        legalName: data.legalName,
        regimenFiscal: data.regimenFiscal,
        codigoPostal: data.codigoPostal,
        serie: data.serie,
        pacMode: data.pacMode,
        pacProvider: data.pacProvider,
        pacApiKey: data.pacApiKey,
      },
    });
  }

  async getFiscalProfile(orgId: string) {
    return this.prisma.fiscalProfile.findUnique({ where: { organizationId: orgId } });
  }

  async stampOrderInvoice(
    orgId: string,
    data: {
      orderId: string;
      receptorRfc: string;
      receptorNombre: string;
      receptorUsoCfdi?: string;
    }
  ) {
    const profile = await this.prisma.fiscalProfile.findUnique({
      where: { organizationId: orgId },
    });
    if (!profile?.active) {
      throw new BadRequestException('Configure fiscal profile before stamping CFDI');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: data.orderId, organizationId: orgId, status: 'COMPLETED' },
    });
    if (!order) throw new NotFoundException('Completed order not found');

    const existing = await this.prisma.cfdiInvoice.findFirst({
      where: { orderId: order.id, status: 'STAMPED', tipo: 'I' },
    });
    if (existing) return existing;

    const folio = profile.nextFolio;
    const subtotal = Number(order.subtotal);
    const iva = Number(order.taxAmount);
    const total = Number(order.totalAmount);

    const isSandbox = profile.pacMode !== 'production';
    const uuid = isSandbox ? randomUUID() : randomUUID(); // production: replace with PAC response UUID

    const xml = this.buildSandboxXml({
      uuid,
      rfcEmisor: profile.rfc,
      nombreEmisor: profile.legalName,
      rfcReceptor: data.receptorRfc.toUpperCase(),
      nombreReceptor: data.receptorNombre,
      serie: profile.serie,
      folio,
      subtotal,
      iva,
      total,
    });

    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.fiscalProfile.update({
        where: { id: profile.id },
        data: { nextFolio: folio + 1 },
      });

      return tx.cfdiInvoice.create({
        data: {
          organizationId: orgId,
          orderId: order.id,
          uuid,
          serie: profile.serie,
          folio,
          tipo: 'I',
          status: 'STAMPED',
          receptorRfc: data.receptorRfc.toUpperCase(),
          receptorNombre: data.receptorNombre,
          receptorUsoCfdi: data.receptorUsoCfdi ?? 'G03',
          subtotal,
          iva,
          total,
          currency: order.currency,
          stampedAt: new Date(),
          pacRaw: {
            mode: profile.pacMode,
            provider: profile.pacProvider ?? 'boletera-sandbox',
            xmlSha256: createHash('sha256').update(xml).digest('hex'),
            xmlPreview: xml.slice(0, 500),
          },
        },
      });
    });

    await this.audit.log({
      action: 'CFDI_STAMPED',
      entityType: 'CfdiInvoice',
      entityId: invoice.id,
      organizationId: orgId,
      metadata: { orderId: order.id, uuid, sandbox: isSandbox },
    });

    return { ...invoice, sandbox: isSandbox, xml };
  }

  async listInvoices(orgId: string) {
    return this.prisma.cfdiInvoice.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private buildSandboxXml(p: {
    uuid: string;
    rfcEmisor: string;
    nombreEmisor: string;
    rfcReceptor: string;
    nombreReceptor: string;
    serie: string;
    folio: number;
    subtotal: number;
    iva: number;
    total: number;
  }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" Serie="${p.serie}" Folio="${p.folio}" SubTotal="${p.subtotal.toFixed(2)}" Total="${p.total.toFixed(2)}" Moneda="MXN"
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4">
  <cfdi:Emisor Rfc="${p.rfcEmisor}" Nombre="${p.nombreEmisor}"/>
  <cfdi:Receptor Rfc="${p.rfcReceptor}" Nombre="${p.nombreReceptor}" UsoCFDI="G03"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="${p.iva.toFixed(2)}"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="${p.uuid}" FechaTimbrado="${new Date().toISOString()}" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
  }
}
