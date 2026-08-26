import type { Metadata } from "next";
import { Bebas_Neue, Space_Grotesk } from "next/font/google";
import { CartBar } from "@/components/CartBar";
import { SiteFooter } from "@/components/SiteFooter";
// El sistema de diseno va PRIMERO: define los --bl-* de los que
// derivan los tokens locales. Sin esta linea cada pantalla caia a
// su reserva codificada a mano y las familias de gris no concordaban.
import "@boletera/ui/src/styles/theme.scss";
import "./globals.css";

const headingFont = Bebas_Neue({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: "400"
});

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "Boletera | Boletos oficiales",
  description:
    "Compra boletos oficiales con inventario real, mapa de asientos y pagos Banorte.",
};

/** Inline boot: lock light theme before paint (storefront is light-only). */
const themeBootScript = `(function(){try{document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
      </head>
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <div className="app-shell">
          <div className="app-shell__content">{children}</div>
          <SiteFooter />
        </div>
        <CartBar />
      </body>
    </html>
  );
}
