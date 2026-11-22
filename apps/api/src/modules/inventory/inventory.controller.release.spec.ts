import { InventoryController } from './inventory.controller';
import { GuestSessionService } from './guest-session.service';

/**
 * Soltar un apartado de invitado: el hold guarda el id verificado de la
 * identidad firmada, así que el controlador debe verificar la cadena que manda
 * el navegador antes de comparar. Antes pasaba la cadena cruda y el dueño
 * recibía 403.
 */
describe('InventoryController · soltar apartado de invitado', () => {
  const previo = process.env.GUEST_SESSION_SECRET;
  beforeAll(() => {
    process.env.GUEST_SESSION_SECRET = 'secreto-de-prueba-solo-para-jest-0123456789';
  });
  afterAll(() => {
    if (previo === undefined) delete process.env.GUEST_SESSION_SECRET;
    else process.env.GUEST_SESSION_SECRET = previo;
  });
  const guestSession = new GuestSessionService();

  function build() {
    const releaseHold = jest.fn().mockResolvedValue({ released: true });
    const controller = new InventoryController(
      { releaseHold } as never,
      {} as never,
      guestSession,
      {
        assess: async () => ({ score: 0, level: 'low', reasons: [] }),
        issueChallengeToken: () => 't',
        verifyChallengeToken: () => true,
      } as never,
      { log: async () => undefined } as never
    );
    return { controller, releaseHold };
  }

  it('pasa al servicio el id verificado, no la cadena firmada', async () => {
    const { controller, releaseHold } = build();
    const issued = guestSession.issue();
    const verified = guestSession.verify(issued.token);
    expect(verified).not.toBeNull();

    await controller.release('h1', undefined as never, { sessionId: issued.token });
    expect(releaseHold).toHaveBeenCalledWith('h1', {
      sessionId: verified!.id,
      userId: undefined,
      staff: false,
    });
  });

  it('una identidad falsificada se rechaza y no llega al servicio', async () => {
    const { controller, releaseHold } = build();
    expect(() =>
      controller.release('h1', undefined as never, { sessionId: 'v2.inventada.1.firma' })
    ).toThrow('Sesión de invitado no válida');
    expect(releaseHold).not.toHaveBeenCalled();
  });
});
