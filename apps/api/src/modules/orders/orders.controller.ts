import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  Post,
  Query,
  Request,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SalesChannel } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateOrderDto, type OrderRequester } from './orders.dto';
import { OrdersService } from './orders.service';

type OptionalAuthRequest = { user?: { sub: string; email?: string; role?: string } };

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  create(
    @Body() body: CreateOrderDto,
    @Request() req: OptionalAuthRequest,
    @Headers('x-channel') channelHeader?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    // `x-channel` es telemetría, no autorización: el servicio degrada a WEB si
    // no hay personal autenticado detrás. El cajero sale del token, así que
    // `x-cashier-id` ya no se lee, y `userId` tampoco viene del cuerpo (F1-01).
    const requestedChannel =
      channelHeader?.toUpperCase() === 'TAQUILLA' ? SalesChannel.TAQUILLA : SalesChannel.WEB;
    return this.orders.createOrder({
      ...body,
      userId: req.user?.sub,
      actorUserId: req.user?.sub,
      actorRole: req.user?.role,
      channel: requestedChannel,
      untrustedRequest: true,
      idempotencyKey,
      ipAddress: forwardedFor?.split(',')[0]?.trim(),
    });
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  myOrders(@Request() req: { user: { sub: string } }) {
    return this.orders.listForUser(req.user.sub);
  }

  @Get(':publicId/status')
  status(@Param('publicId') publicId: string) {
    return this.orders.getStatus(publicId);
  }

  @Get(':publicId/qrcodes')
  @UseGuards(OptionalJwtAuthGuard)
  qrcodes(
    @Param('publicId') publicId: string,
    @Request() req: OptionalAuthRequest,
    @Query('accessToken') accessToken?: string,
  ) {
    return this.orders.getQrCodesForOrder(publicId, this.requester(req, accessToken));
  }

  @Get(':publicId/tickets.pdf')
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Content-Type', 'application/pdf')
  async ticketsPdf(
    @Param('publicId') publicId: string,
    @Request() req: OptionalAuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('accessToken') accessToken?: string,
  ) {
    const buf = await this.orders.buildTicketsPdf(publicId, this.requester(req, accessToken));
    res.set({
      'Content-Disposition': `attachment; filename="boletera-${publicId}.pdf"`,
    });
    return new StreamableFile(buf);
  }

  @Post(':publicId/cfdi')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  requestCfdi(
    @Param('publicId') publicId: string,
    @Request() req: { user: { sub: string } },
    @Body()
    body: { receptorRfc: string; receptorNombre: string; receptorUsoCfdi?: string },
  ) {
    return this.orders.requestCfdiForBuyer(publicId, req.user.sub, body);
  }

  @Get(':publicId')
  @UseGuards(OptionalJwtAuthGuard)
  get(
    @Param('publicId') publicId: string,
    @Request() req: OptionalAuthRequest,
    @Query('accessToken') accessToken?: string,
  ) {
    return this.orders.getForRequester(publicId, this.requester(req, accessToken));
  }

  /** Identidad del solicitante: JWT verificado o token del enlace del correo. */
  private requester(req: OptionalAuthRequest, accessToken?: string): OrderRequester {
    return { userId: req.user?.sub, email: req.user?.email, accessToken };
  }
}
