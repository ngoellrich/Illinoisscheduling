import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solar Scheduler",
  description: "Book solar appointments and auto-assign to reps by availability and weekly load.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
