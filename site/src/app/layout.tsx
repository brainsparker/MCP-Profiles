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
  title: "MCP Profiles — programmable identity for AI agents",
  description: SITE.description,
  keywords: [
    "MCP",
    "Model Context Protocol",
    "AI agents",
    "agent identity",
    "agent profiles",
    "retrieval",
    "tool permissions",
  ],
  authors: [{ name: "Brian Sparker" }],
  openGraph: {
    title: "MCP Profiles — programmable identity for AI agents",
    description: SITE.description,
    url: SITE.url,
    siteName: "MCP Profiles",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MCP Profiles",
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
