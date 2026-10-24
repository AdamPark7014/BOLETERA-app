import type { Metadata } from "next";
import { Bebas_Neue, Space_Grotesk } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { BlackTicketRoot } from "@boletera/ui";
import { TenantBrandProvider } from "@/components/TenantBrand";
import { buildOrganizationWebsiteJsonLd } from "@/lib/seo/event-jsonld";
import { getSiteOrigin } from "@/lib/site-url";
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
  const [tenant, origin] = await Promise.all([fetchTenantCurrent(), getSiteOrigin()]);
  const favicon = tenant.theme?.faviconUrl?.trim();
  const logo = tenant.theme?.logoUrl?.trim();
  return {
    metadataBase: new URL(origin),
    title: `${tenant.name} | Boletos oficiales`,
    description: `Compra boletos oficiales en ${tenant.name}: inventario real, mapa de asientos y pagos Banorte.`,
    icons: {
      icon: favicon || "/favicon.svg",
      apple: favicon || logo || "/favicon.svg",
    },
    openGraph: {
      siteName: tenant.name,
      locale: "es_MX",
      type: "website",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [tenant, origin] = await Promise.all([fetchTenantCurrent(), getSiteOrigin()]);
  const brand = {
    name: tenant.name,
    logoUrl: tenant.theme?.logoUrl ?? null,
    faviconUrl: tenant.theme?.faviconUrl ?? null,
    primaryColor: tenant.theme?.primaryColor ?? null,
    secondaryColor: tenant.theme?.secondaryColor ?? null,
  };
  const siteJsonLd = buildOrganizationWebsiteJsonLd({
    origin,
    name: tenant.name,
    logoUrl: tenant.theme?.logoUrl,
  });

  return (
    <html
      lang="es"
      data-theme="light"
      suppressHydrationWarning
      style={tenantThemeStyle(tenant.theme)}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
      </head>
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <TenantBrandProvider value={brand}>
          <BlackTicketRoot density="compra" className="app-shell">
            <div className="app-shell__content">{children}</div>
            <SiteFooter />
          </BlackTicketRoot>
        </TenantBrandProvider>
      </body>
    </html>
  );
}
