import "./globals.css";

export const metadata = {
  title: "Telegram Affiliate Bot Dashboard",
  description: "Administrative console for Telegram to WhatsApp affiliate deal forwarding bot.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
