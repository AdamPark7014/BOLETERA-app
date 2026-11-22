import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../../common/redis.service';

export type ChallengeRecord = {
  subject: string;
  eventId: string;
  salt: string;
  bits: number;
};

export type IssuedChallenge = {
  challengeId: string;
  salt: string;
  bits: number;
  expiresAt: string;
  provider: 'pow';
};

export type TurnstileChallenge = {
  provider: 'turnstile';
  siteKey: string;
};

export type ClearanceResult = {
  clearanceToken: string;
  expiresAt: string;
};

const CHALLENGE_TTL_SEC = 120;
const CLEARANCE_TTL_MS = 10 * 60_000;

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reto antibots de uso único.
 *
 * El 428 solo entrega el reto (PoW o Turnstile), nunca un pase.
 * Tras resolver se emite un clearance HMAC de 10 min atado a sujeto y evento.
 */
@Injectable()
export class HumanChallengeService implements OnModuleInit {
  private readonly logger = new Logger(HumanChallengeService.name);
  private readonly secret: string;
  private readonly bits: number;
  private readonly issueLimit: number;

  constructor(private readonly redis: RedisService) {
    const configured =
      process.env.RISK_CHALLENGE_SECRET ||
      process.env.GUEST_SESSION_SECRET ||
      process.env.JWT_SECRET;
    if (configured) {
      this.secret = configured;
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Falta RISK_CHALLENGE_SECRET (o GUEST_SESSION_SECRET / JWT_SECRET): el reto antibots no se puede firmar.'
      );
    } else {
      this.secret = randomBytes(32).toString('hex');
      this.logger.warn(
        'Sin RISK_CHALLENGE_SECRET: usando secreto aleatorio por proceso (solo desarrollo).'
      );
    }
    this.bits = positiveIntEnv('HUMAN_CHALLENGE_BITS', 16);
    this.issueLimit = positiveIntEnv('HUMAN_CHALLENGE_ISSUE_LIMIT', 20);
  }

  onModuleInit() {
    void this.secret;
  }

  provider(): 'pow' | 'turnstile' {
    const wantTurnstile = (process.env.HUMAN_CHALLENGE_PROVIDER || 'pow').toLowerCase() === 'turnstile';
    if (
      wantTurnstile &&
      process.env.TURNSTILE_SECRET_KEY &&
      process.env.TURNSTILE_SITE_KEY
    ) {
      return 'turnstile';
    }
    return 'pow';
  }

  async issue(subject: string, eventId: string): Promise<IssuedChallenge | TurnstileChallenge> {
    const rateKey = `risk:challenge:issue:${subject}`;
    const count = await this.redis.incrementWithTtl(rateKey, 1, 60);
    if (count != null && count > this.issueLimit) {
      throw new BadRequestException('Demasiados retos. Espera un momento e inténtalo de nuevo.');
    }

    if (this.provider() === 'turnstile') {
      return {
        provider: 'turnstile',
        siteKey: process.env.TURNSTILE_SITE_KEY as string,
      };
    }

    const challengeId = randomBytes(16).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const record: ChallengeRecord = {
      subject,
      eventId,
      salt,
      bits: this.bits,
    };
    const saved = await this.redis.setJson(
      `risk:challenge:${challengeId}`,
      record,
      CHALLENGE_TTL_SEC
    );
    if (!saved) {
      throw new BadRequestException('No se pudo emitir el reto. Inténtalo de nuevo.');
    }
    return {
      challengeId,
      salt,
      bits: this.bits,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SEC * 1000).toISOString(),
      provider: 'pow',
    };
  }

  leadingZeroBits(buf: Buffer): number {
    let bits = 0;
    for (const byte of buf) {
      if (byte === 0) {
        bits += 8;
        continue;
      }
      for (let i = 7; i >= 0; i--) {
        if ((byte >> i) & 1) return bits;
        bits++;
      }
    }
    return bits;
  }

  async verify(challengeId: string, counter: string, subject: string): Promise<ChallengeRecord> {
    if (!/^\d{1,20}$/.test(counter)) {
      throw new BadRequestException('El contador del reto no es válido.');
    }
    const record = await this.redis.takeJson<ChallengeRecord>(`risk:challenge:${challengeId}`);
    if (!record) {
      throw new BadRequestException('El reto no es válido o ya se usó.');
    }
    if (record.subject !== subject) {
      throw new BadRequestException('El reto no corresponde a esta sesión.');
    }
    const digest = createHash('sha256')
      .update(`${record.salt}:${challengeId}:${counter}`)
      .digest();
    if (this.leadingZeroBits(digest) < record.bits) {
      throw new BadRequestException('La prueba de trabajo no alcanza la dificultad pedida.');
    }
    return record;
  }

  issueClearance(subject: string, eventId: string): ClearanceResult {
    const exp = Date.now() + CLEARANCE_TTL_MS;
    const payload = `clr.v1|${subject}|${eventId}|${exp}`;
    const mac = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const clearanceToken = `${Buffer.from(payload).toString('base64url')}.${mac}`;
    return { clearanceToken, expiresAt: new Date(exp).toISOString() };
  }

  verifyClearance(token: string | undefined, subject: string, eventId: string): boolean {
    if (!token) return false;
    const [encoded, mac] = token.split('.');
    if (!encoded || !mac) return false;
    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return false;
    }
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(mac);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    const [version, tokSubject, tokEventId, expRaw] = payload.split('|');
    if (version !== 'clr.v1') return false;
    if (tokSubject !== subject || tokEventId !== eventId) return false;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp <= Date.now()) return false;
    return true;
  }

  async verifyTurnstile(token: string, ip?: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret || !token) return false;
    try {
      const body = new URLSearchParams();
      body.set('secret', secret);
      body.set('response', token);
      if (ip) body.set('remoteip', ip);
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch (error) {
      this.logger.warn(
        `Turnstile no respondió: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}
