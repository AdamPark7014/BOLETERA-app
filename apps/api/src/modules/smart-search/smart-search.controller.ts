import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TenantService } from '../tenant/tenant.service';
import { pickTenantHost } from '../tenant/tenant-host';
import { SmartSearchService } from './smart-search.service';

function clientIp(req: Request): string {
  const xf = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xf || req.ip || 'unknown';
}

@ApiTags('SmartSearch')
@Controller('smart-search')
export class SmartSearchController {
  constructor(
    private readonly smart: SmartSearchService,
    private readonly tenant: TenantService
  ) {}

  @Get('status')
  status() {
    return { assistant: this.smart.assistantAvailable() };
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async search(
    @Headers() headers: Record<string, string>,
    @Req() req: Request,
    @Body() body: { q?: string; city?: string; sessionId?: string }
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return { understood: '', chips: [], results: [], alternatives: [] };
    return this.smart.search({
      q: body?.q ?? '',
      city: body?.city,
      orgId: org.id,
      ip: clientIp(req),
      sessionId: body?.sessionId || (req.headers['x-session-id'] as string | undefined),
    });
  }

  @Get('suggest')
  async suggest(
    @Headers() headers: Record<string, string>,
    @Query('q') q?: string,
    @Query('limit') limit?: string
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org || !q?.trim()) return { events: [], venues: [], cities: [], artists: [] };
    return this.smart.suggest({
      orgId: org.id,
      q,
      limit: limit ? parseInt(limit, 10) : 6,
    });
  }

  @Post('recommend')
  async recommend(
    @Headers() headers: Record<string, string>,
    @Body()
    body: { viewedEventIds?: string[]; limit?: number; userId?: string }
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return { items: [], reason: 'cartelera' };
    return this.smart.recommend({
      orgId: org.id,
      userId: body?.userId,
      viewedEventIds: body?.viewedEventIds,
      limit: body?.limit,
    });
  }

  @Post('assistant')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async assistant(
    @Headers() headers: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { eventId?: string; question?: string; sessionId?: string }
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) {
      res.status(404).json({ message: 'Organización no encontrada' });
      return;
    }
    if (!body?.eventId || !body?.question?.trim()) {
      res.status(400).json({ message: 'Faltan eventId o question' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const stream = await this.smart.askAssistant({
        orgId: org.id,
        eventId: body.eventId,
        question: body.question,
        sessionId: body.sessionId,
        ip: clientIp(req),
      });
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write('data: {"done":true}\n\n');
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message =
        (error as { response?: { message?: string }; message?: string }).response?.message ||
        (error as Error).message ||
        'Error';
      res.write(`data: ${JSON.stringify({ error: message, status })}\n\n`);
    }
    res.end();
  }
}
