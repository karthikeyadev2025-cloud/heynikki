import type { MetadataRoute } from "next";

// Sprint 5 deliverable that was never built. Without a manifest there
// is no "Add to Home Screen" on Android, which matters more than usual
// here: the owners using this dashboard are running a shop or a clinic
// from a phone, and a browser tab is not where they will keep it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hey Nikki — Telugu AI Receptionist",
    short_name: "Hey Nikki",
    description:
      "Your business never misses a call. Hey Nikki answers in Telugu, books appointments and confirms on WhatsApp.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F5F0",
    theme_color: "#0B1F33",
    lang: "te-IN",
    dir: "ltr",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/icon.svg",        sizes: "any",     type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png",    sizes: "192x192", type: "image/png",     purpose: "any" },
      { src: "/icon-512.png",    sizes: "512x512", type: "image/png",     purpose: "any" },
      { src: "/icon-mask.png",   sizes: "512x512", type: "image/png",     purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today's calls",  url: "/calls" },
      { name: "Appointments",   url: "/appointments" },
      { name: "Leads",          url: "/leads" },
    ],
  };
}
