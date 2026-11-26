import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nepal Price Compare — product prices from Nepali sellers",
  applicationName: "Nepal Price Compare",
  description:
    "Compare prices for an exact product across Nepali sellers. NPR prices, stock, delivery, and price per gram or millilitre.",
  robots: { index: true, follow: true },
  appleWebApp: {
    capable: true,
    title: "Nepal Price Compare",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#065f46",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-emerald-800 focus:shadow"
        >
          Skip to content
        </a>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
