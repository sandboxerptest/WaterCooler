import type { Metadata, Viewport } from "next";
import { Press_Start_2P } from "next/font/google";
import "./globals.css";

const pressStart2P = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "WaterCooler",
  description: "A pixel office where AI agents work",
};

/**
 * Without this a phone lays the page out at 980px and scales it down, which
 * turns every control into something you have to pinch at. `viewportFit`
 * lets the game reach under the notch; the safe-area insets in the CSS keep
 * anything you need to press out from under it.
 *
 * Zoom is deliberately left alone: the game surface blocks pinch and
 * double-tap through `touch-action`, so there is no need to take it away
 * from the rest of the page.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${pressStart2P.variable}`}>
      <body>{children}</body>
    </html>
  );
}
