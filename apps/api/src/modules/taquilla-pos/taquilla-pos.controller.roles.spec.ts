import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/roles.decorator';
import { TaquillaPosController } from './taquilla-pos.controller';

/**
 * SCANNER (personal de puerta) solo lista funciones y escanea. Con el rol en
 * la clase abría turno, veía cortes Z y llegaba al cobro.
 */
describe('TaquillaPosController · rol SCANNER', () => {
  const reflector = new Reflector();
  const proto = TaquillaPosController.prototype as unknown as Record<string, () => unknown>;
  const rolesOf = (method: string): string[] =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [proto[method], TaquillaPosController]) ?? [];

  it('la clase no admite SCANNER', () => {
    expect(reflector.get<string[]>(ROLES_KEY, TaquillaPosController)).not.toContain('SCANNER');
  });

  it('SCANNER sí lista funciones y escanea', () => {
    expect(rolesOf('events')).toContain('SCANNER');
    expect(rolesOf('scanBarcode')).toContain('SCANNER');
  });

  it('SCANNER no abre turno, no cobra ni ve cortes', () => {
    const otros = Object.getOwnPropertyNames(TaquillaPosController.prototype).filter(
      (m) => m !== 'constructor' && m !== 'events' && m !== 'scanBarcode'
    );
    expect(otros.length).toBeGreaterThan(5);
    for (const m of otros) expect(rolesOf(m)).not.toContain('SCANNER');
  });
});
