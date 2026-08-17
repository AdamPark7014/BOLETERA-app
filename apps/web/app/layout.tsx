import type { Metadata } from "next";
import { Bebas_Neue, Space_Grotesk } from "next/font/google";
import { CartBar } from "@/components/CartBar";
import { SiteFooter } from "@/components/SiteFooter";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
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
