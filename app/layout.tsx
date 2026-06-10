import type { Metadata, Viewport } from "next";
import { ConnectivityBanner } from "@/components/pwa/ConnectivityBanner";
import { DevSwCleanup } from "@/components/pwa/DevSwCleanup";
import "../styles/globals.css";
import "../styles/reader.css";
import "../styles/panel.css";
import "../styles/modal.css";

export const metadata: Metadata = {
  title: "AIBook — Language Learning Reader",
  description: "Read books and learn languages with AI. Tap any word for instant translation, grammar breakdown, and smart flashcards.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-512x512.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#141210",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <DevSwCleanup />
        <ConnectivityBanner />
        {children}
      </body>
    </html>
  );
}
