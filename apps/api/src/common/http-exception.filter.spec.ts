import { ConflictException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

function host() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return {
    res,
    host: { switchToHttp: () => ({ getResponse: () => res }) } as never,
  };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it.each(['P2024', 'P2028', 'P2034'])(
    'saturación de la base (%s) → 503 con Retry-After',
    (code) => {
      const { res, host: h } = host();
      filter.catch(Object.assign(new Error('Transaction API error'), { code }), h);
      expect(res.statusCode).toBe(503);
      expect(res.headers['Retry-After']).toBe('2');
    }
  );

  it('otros errores siguen siendo 500 genérico', () => {
    const { res, host: h } = host();
    filter.catch(Object.assign(new Error('boom'), { code: 'P2002' }), h);
    expect(res.statusCode).toBe(500);
  });

  it('las HttpException conservan su estado', () => {
    const { res, host: h } = host();
    filter.catch(new ConflictException('ocupado'), h);
    expect(res.statusCode).toBe(409);
  });
});
