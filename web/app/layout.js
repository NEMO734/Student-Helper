import './globals.css';

export const metadata = {
  title: "Team Ator's Student Helper",
  description:
    "Team Ator's Student Helper (Web Edition) — UPSA Virtual Past Questions & Lecture Notes Downloader by Kingseight",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
