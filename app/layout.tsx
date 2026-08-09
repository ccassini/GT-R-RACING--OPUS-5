import type { Metadata, Viewport } from 'next';
import { Anton, Barlow, Barlow_Condensed } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font, so the fonts are no longer a
// render-blocking round trip to two Google origins on first paint.
const anton = Anton({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-anton',
});

const barlowCondensed = Barlow_Condensed({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-condensed',
});

const barlow = Barlow({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow',
});

export const metadata: Metadata = {
  title: 'GT-R Racing',
  description:
    "Bird's-eye arcade racing over five circuits, with verifiable on-chain race records.",
};

export const viewport: Viewport = {
  themeColor: '#0b0e13',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${barlowCondensed.variable} ${barlow.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
