import { Archivo, Pinyon_Script, Roboto, Roboto_Mono } from 'next/font/google';

// Tipografía Black Ticket (maqueta 14-11-2026): Roboto para texto, Archivo
// condensado para titulares y cifras, Pinyon Script para el «Black» del logo.
// Cada familia publica su variable CSS; los tokens de @boletera/ui las leen.
const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '900'],
  variable: '--font-roboto',
  display: 'swap',
});

const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
});

const script = Pinyon_Script({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-script',
  display: 'swap',
});

const mono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-roboto-mono',
  display: 'swap',
});

export const blackTicketFontVars = [roboto, archivo, script, mono]
  .map((font) => font.variable)
  .join(' ');
