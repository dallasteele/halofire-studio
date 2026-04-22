import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import {
  Barlow,
  Fraunces,
  IBM_Plex_Mono,
  JetBrains_Mono,
} from 'next/font/google'
import localFont from 'next/font/local'
import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Halofire Studio',
    template: '%s — Halofire Studio',
  },
  description:
    'Fire-sprinkler design + hydraulic modeling. The estimator\'s drafting room.',
}

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
})

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
})

/**
 * Phase G design system — committed.
 *
 * - Fraunces (variable serif) is the "hero data" voice — large pressure
 *   and price readouts get characterful serifs, the way an engineering
 *   drawing's title block would.
 * - IBM Plex Mono is the body voice — every label, every button, every
 *   panel chrome element. CAD-correct, technical, quietly confident.
 * - JetBrains Mono is the numeric voice — SKUs, coordinates, table
 *   figures. Tabular numerals with zero-slash, so 68 psi never
 *   shimmies when the solver updates.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-mono',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      className={[
        geistSans.variable,
        geistMono.variable,
        GeistPixelSquare.variable,
        barlow.variable,
        fraunces.variable,
        plexMono.variable,
        jetbrains.variable,
        // Force dark shell — HaloFire is a dark tool, always.
        'dark',
      ].join(' ')}
      lang="en"
    >
      <head>
        {process.env.NODE_ENV === 'development' && (
          <Script
            crossOrigin="anonymous"
            src="//unpkg.com/react-scan/dist/auto.global.js"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body className="font-sans bg-[var(--color-hf-bg)] text-[var(--color-hf-ink)]">
        {children}
        {process.env.NODE_ENV === 'development' && <Agentation />}
      </body>
    </html>
  )
}
