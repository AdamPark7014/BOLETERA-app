import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../../common/redis.service';

export type RiskLevel = 'low' | 'medium' | 'high';

export type RiskAssessment = {
  score: number;
  level: RiskLevel;
  reasons: string[];
};

const AUTOMATION_UA =
  /curl\/|python-requests|scrapy|headless|puppeteer|playwright|selenium|axios\/|go-http|httpclient|bot\b|crawler/i;

/**
 * Puntaje simple de riesgo. Nunca bloquea: el controller manda a un reto
 * cuando el nivel es alto.
 */
@Injectable()
export class BuyerRiskService {
  constructor(private readonly redis: RedisService) {}

  async assess(input: {
    ip?: string;
    userAgent?: string;
    sessionId?: string;
    eventId?: string;
  }): Promise<RiskAssessment> {
    const reasons: string[] = [];
    let score = 0;
    const ip = (input.ip || 'unknown').slice(0, 64);
    const ua = input.userAgent || '';

    const rate = (await this.redis.incrementWithTtl(`risk:ip:${ip}:rate`, 1, 60)) ?? 0;
    if (rate > 80) {
      score += 40;
      reasons.push('muchas peticiones desde la misma IP');
    } else if (rate > 30) {
      score += 30;
      reasons.push('ritmo alto de peticiones');
    }

    if (input.sessionId) {
      const sessKey = `risk:ip:${ip}:sess`;
      const current = (await this.redis.getJson<string[]>(sessKey)) ?? [];
      if (!current.includes(input.sessionId)) {
        current.push(input.sessionId);
        if (current.length > 20) current.splice(0, current.length - 20);
        await this.redis.setJson(sessKey, current, 60);
      }
      if (current.length > 12) {
        score += 40;
        reasons.push('muchas sesiones distintas desde la misma IP');
      } else if (current.length > 5) {
        score += 25;
        reasons.push('varias sesiones desde la misma IP');
      }
    }

    if (ua && AUTOMATION_UA.test(ua)) {
      score += 35;
      reasons.push('agente de usuario de automatización');
    }

    const level: RiskLevel = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
    return { score: Math.min(100, score), level, reasons };
  }

  issueChallengeToken(subject: string): string {
    const day = Math.floor(Date.now() / 86_400_000);
    const payload = `challenge:${subject}:${day}`;
    const mac = createHmac('sha256', this.secret()).update(payload).digest('base64url');
    return `${Buffer.from(payload).toString('base64url')}.${mac}`;
  }

  verifyChallengeToken(token: string | undefined, subject: string): boolean {
    if (!token) return false;
    const [encoded, mac] = token.split('.');
    if (!encoded || !mac) return false;
    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return false;
    }
    const day = Math.floor(Date.now() / 86_400_000);
    const expectedPayload = `challenge:${subject}:${day}`;
    const prevPayload = `challenge:${subject}:${day - 1}`;
    if (payload !== expectedPayload && payload !== prevPayload) return false;
    const expected = createHmac('sha256', this.secret()).update(payload).digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(mac);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private secret(): string {
    return process.env.JWT_SECRET || process.env.GUEST_SESSION_SECRET || 'dev-risk';
  }
}
