import type { Metadata } from "next";
import { Bebas_Neue, Space_Grotesk } from "next/font/google";
import { CartBar } from "@/components/CartBar";
import { SiteFooter } from "@/components/SiteFooter";
import { TenantBrandProvider } from "@/components/TenantBrand";
import { fetchTenantCurrent, tenantThemeStyle } from "@/lib/tenant";
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

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await fetchTenantCurrent();
  const favicon = tenant.theme?.faviconUrl?.trim();
  return {
    title: `${tenant.name} | Boletos oficiales`,
    description: `Compra boletos oficiales en ${tenant.name}: inventario real, mapa de asientos y pagos Banorte.`,
    icons: favicon ? { icon: favicon } : undefined,
  };
}

/** Inline boot: lock light theme before paint (storefront is light-only). */
const themeBootScript = `(function(){try{document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = await fetchTenantCurrent();
  const brand = {
    name: tenant.name,
    logoUrl: tenant.theme?.logoUrl ?? null,
    faviconUrl: tenant.theme?.faviconUrl ?? null,
    primaryColor: tenant.theme?.primaryColor ?? null,
    secondaryColor: tenant.theme?.secondaryColor ?? null,
  };

  return (
    <html
      lang="es"
      data-theme="light"
      suppressHydrationWarning
      style={tenantThemeStyle(tenant.theme)}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
      </head>
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <TenantBrandProvider value={brand}>
          <div className="app-shell">
            <div className="app-shell__content">{children}</div>
            <SiteFooter brandName={brand.name} logoUrl={brand.logoUrl} />
          </div>
          <CartBar />
        </TenantBrandProvider>
      </body>
    </html>
  );
}
