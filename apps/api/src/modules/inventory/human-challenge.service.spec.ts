import { createHash, createHmac, randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { HumanChallengeService } from './human-challenge.service';

describe('HumanChallengeService', () => {
  const store = new Map<string, { value: string; exp?: number }>();

  function makeRedis() {
    return {
      isReady: true,
      incrementWithTtl: jest.fn(async (key: string) => {
        const cur = Number(store.get(key)?.value ?? 0) + 1;
        store.set(key, { value: String(cur) });
        return cur;
      }),
      setJson: jest.fn(async (key: string, value: unknown, ttl: number) => {
        store.set(key, { value: JSON.stringify(value), exp: Date.now() + ttl * 1000 });
        return true;
      }),
      takeJson: jest.fn(async (key: string) => {
        const row = store.get(key);
        if (!row) return null;
        store.delete(key);
        try {
          return JSON.parse(row.value);
        } catch {
          return null;
        }
      }),
    };
  }

  function make(env: Record<string, string | undefined> = {}) {
    const prev = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      RISK_CHALLENGE_SECRET: 'test-secret-challenge',
      HUMAN_CHALLENGE_BITS: '8',
      HUMAN_CHALLENGE_PROVIDER: 'pow',
      ...env,
    });
    const redis = makeRedis();
    const svc = new HumanChallengeService(redis as never);
    return {
      svc,
      redis,
      restore() {
        process.env = prev;
      },
    };
  }

  afterEach(() => {
    store.clear();
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
  });

  function solvePow(salt: string, challengeId: string, bits: number): string {
    for (let counter = 0; counter < 5_000_000; counter++) {
      const digest = createHash('sha256').update(`${salt}:${challengeId}:${counter}`).digest();
      let zeros = 0;
      outer: for (const byte of digest) {
        if (byte === 0) {
          zeros += 8;
          continue;
        }
        for (let i = 7; i >= 0; i--) {
          if ((byte >> i) & 1) break outer;
          zeros++;
        }
        break;
      }
      if (zeros >= bits) return String(counter);
    }
    throw new Error('no solution');
  }

  it('rechaza contador incorrecto', async () => {
    const { svc, restore } = make();
    try {
      const issued = (await svc.issue('sub-a', 'evt-1')) as {
        challengeId: string;
        salt: string;
        bits: number;
      };
      await expect(svc.verify(issued.challengeId, '0', 'sub-a')).rejects.toBeInstanceOf(
        BadRequestException
      );
    } finally {
      restore();
    }
  });

  it('no reutiliza el reto', async () => {
    const { svc, restore } = make();
    try {
      const issued = (await svc.issue('sub-a', 'evt-1')) as {
        challengeId: string;
        salt: string;
        bits: number;
      };
      const counter = solvePow(issued.salt, issued.challengeId, issued.bits);
      await svc.verify(issued.challengeId, counter, 'sub-a');
      await expect(svc.verify(issued.challengeId, counter, 'sub-a')).rejects.toBeInstanceOf(
        BadRequestException
      );
    } finally {
      restore();
    }
  });

  it('rechaza otro sujeto', async () => {
    const { svc, restore } = make();
    try {
      const issued = (await svc.issue('sub-a', 'evt-1')) as {
        challengeId: string;
        salt: string;
        bits: number;
      };
      const counter = solvePow(issued.salt, issued.challengeId, issued.bits);
      await expect(svc.verify(issued.challengeId, counter, 'otro')).rejects.toBeInstanceOf(
        BadRequestException
      );
    } finally {
      restore();
    }
  });

  it('rechaza bits insuficientes', async () => {
    const { svc, restore } = make({ HUMAN_CHALLENGE_BITS: '20' });
    try {
      const issued = (await svc.issue('sub-a', 'evt-1')) as {
        challengeId: string;
        salt: string;
        bits: number;
      };
      await expect(svc.verify(issued.challengeId, '1', 'sub-a')).rejects.toBeInstanceOf(
        BadRequestException
      );
    } finally {
      restore();
    }
  });

  it('pase de otro evento o sujeto o alterado falla', () => {
    const { svc, restore } = make();
    try {
      const { clearanceToken } = svc.issueClearance('sub-a', 'evt-1');
      expect(svc.verifyClearance(clearanceToken, 'sub-a', 'evt-2')).toBe(false);
      expect(svc.verifyClearance(clearanceToken, 'otro', 'evt-1')).toBe(false);
      const [enc, mac] = clearanceToken.split('.');
      expect(svc.verifyClearance(`${enc}.${mac.slice(0, -2)}aa`, 'sub-a', 'evt-1')).toBe(false);
    } finally {
      restore();
    }
  });

  it('pase vencido falla', () => {
    const { svc, restore } = make();
    try {
      const exp = Date.now() - 1000;
      const payload = `clr.v1|sub-a|evt-1|${exp}`;
      const mac = createHmac('sha256', 'test-secret-challenge').update(payload).digest('base64url');
      const token = `${Buffer.from(payload).toString('base64url')}.${mac}`;
      expect(svc.verifyClearance(token, 'sub-a', 'evt-1')).toBe(false);
    } finally {
      restore();
    }
  });

  it('en produccion sin secreto falla al construir', () => {
    const prev = { ...process.env };
    try {
      delete process.env.RISK_CHALLENGE_SECRET;
      delete process.env.GUEST_SESSION_SECRET;
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = 'production';
      expect(() => new HumanChallengeService(makeRedis() as never)).toThrow(/RISK_CHALLENGE_SECRET/);
    } finally {
      process.env = prev;
    }
  });

  it('leadingZeroBits cuenta ceros', () => {
    const { svc, restore } = make();
    try {
      expect(svc.leadingZeroBits(Buffer.from([0x00, 0x0f]))).toBe(12);
      expect(svc.leadingZeroBits(Buffer.from([0x80]))).toBe(0);
    } finally {
      restore();
    }
  });
});
