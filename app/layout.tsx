import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Source_Serif_4,
} from "next/font/google";
import "./globals.css";
import { IblaiProviders } from "@/providers/iblai-providers";

// Geist stays the default for ibl.ai SDK surfaces — those keep the stock brand.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// StudyBuddy's three roles. The split encodes meaning rather than decorating:
// serif is the source material, sans is the system, mono is metadata.
// Two weights per family, no more.

/** The user's own material and the question text. This is *the source*.
 *  Source Serif 4 was drawn for sustained screen reading — exactly this job. */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

/** Every piece of UI chrome: buttons, labels, navigation. This is *the system*. */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

/** Citations, page references, running score. This is *the metadata*. */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "StudyBuddy",
  description:
    "Upload your course material and get quizzed on it. Built on the ibl.ai platform.",
};

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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <IblaiProviders>{children}</IblaiProviders>
      </body>
    </html>
  );
}
