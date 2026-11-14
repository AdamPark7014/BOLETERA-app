import { EventManagementService } from './event-management.service';

/** El slug del evento es la URL pública: los acentos no deben romper la palabra. */
describe('EventManagementService.slugify', () => {
  const slugify = (text: string): string =>
    (Object.create(EventManagementService.prototype) as { slugify(t: string): string }).slugify(
      text
    );

  it('quita acentos y eñes en lugar de partir la palabra', () => {
    expect(slugify('Prueba Límite Año Único')).toMatch(/^prueba-limite-ano-unico-[a-z0-9]+$/);
  });

  it('conserva el sufijo único y limpia los bordes', () => {
    expect(slugify('  ¡Concierto!  ')).toMatch(/^concierto-[a-z0-9]+$/);
  });
});
