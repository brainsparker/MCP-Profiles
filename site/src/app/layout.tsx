import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: "you-aware — search that knows what you're building",
  description: SITE.description,
  keywords: [
    "MCP",
    "Model Context Protocol",
    "AI agents",
    "web search",
    "AGENTS.md",
    "context-aware search",
    "agent retrieval",
    "You.com",
  ],
  authors: [{ name: "Brian Sparker" }],
  openGraph: {
    title: "you-aware — search that knows what you're building",
    description: SITE.description,
    url: SITE.url,
    siteName: "you-aware",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "you-aware",
    description: SITE.description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
