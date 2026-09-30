import localFont from "next/font/local";

export const geistSans = localFont({
  src: "./geist-normal-100-900-92cb7f9a.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist-sans",
});

export const geistMono = localFont({
  src: "./geist-mono-normal-100-900-404bef13.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist-mono",
});
