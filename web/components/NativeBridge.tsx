"use client";

import { useEffect } from "react";
import { installAuthDeepLink, isNativeApp } from "../lib/native";
import { landingFor } from "../lib/landing";
import { createClient } from "../lib/supabase";

/** In the phone app only: catches the Google sign-in deep link even when
 *  the app was cold-started by it (the WebView then opens on the home
 *  page, not /login). No-op in a browser. */
export default function NativeBridge() {
  useEffect(() => {
    installAuthDeepLink(() => landingFor(createClient()));
    // The app has no use for the marketing site: "/" means "take me to my
    // desk" — login if there is no session, otherwise the role's landing.
    if (!isNativeApp() || window.location.pathname !== "/") return;
    const sb = createClient();
    sb.auth.getSession().then(async ({ data }) => {
      window.location.replace(data.session ? await landingFor(sb) : "/login");
    });
  }, []);
  return null;
}
