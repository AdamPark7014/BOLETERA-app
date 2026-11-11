import { checkClabe, clabeControlDigit, isValidClabe, maskClabe, maskEmail } from './clabe';

describe('CLABE (dígito verificador Banxico)', () => {
  it.each(['032180000118359719', '002010077777777771', '646180157000000004'])(
    'acepta la CLABE válida %s',
    (clabe) => {
      expect(isValidClabe(clabe)).toBe(true);
    }
  );

  it('acepta espacios y guiones copiados de la app bancaria', () => {
    expect(checkClabe('032 180 00011835971 9')).toEqual({ ok: true, clabe: '032180000118359719' });
    expect(checkClabe('032-180-000118359719')).toEqual({ ok: true, clabe: '032180000118359719' });
  });

  it('rechaza un dígito verificador equivocado', () => {
    const result = checkClabe('012180001234567897');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'checksum' });
  });

  it('detecta un dígito cambiado en medio', () => {
    expect(isValidClabe('032180000118359729')).toBe(false);
    expect(isValidClabe('132180000118359719')).toBe(false);
  });

  it.each([
    ['', 'vacía'],
    ['03218000011835971', '17 dígitos'],
    ['0321800001183597190', '19 dígitos'],
    ['03218000011835971A', 'con letra'],
  ])('rechaza por formato %s (%s)', (clabe) => {
    expect(checkClabe(clabe)).toMatchObject({ ok: false, reason: 'format' });
  });

  it('rechaza lo que no es texto', () => {
    expect(isValidClabe(32180000118359719)).toBe(false);
    expect(isValidClabe(undefined)).toBe(false);
  });

  it('calcula el control con pesos 3, 7, 1', () => {
    expect(clabeControlDigit('03218000011835971')).toBe(9);
    expect(clabeControlDigit('0321800001183597')).toBeNull();
  });

  it('enmascara dejando solo los últimos 4', () => {
    expect(maskClabe('032180000118359719')).toBe('••••••••••••••9719');
    expect(maskClabe(null)).toBeNull();
  });

  it('enmascara el correo sin dejarlo completo', () => {
    const masked = maskEmail('laura.vega@example.com');
    expect(masked).toBe('la•••@ex•••.com');
    expect(masked).not.toContain('laura.vega');
    expect(masked).not.toContain('example');
  });
});
