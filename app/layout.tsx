import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Планер дня — AI",
  description:
    "Вивали все з голови голосом або текстом — AI перетворить хаос на план на сьогодні.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Зум навмисно НЕ обмежуємо (доступність): користувач може збільшувати сторінку.
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
