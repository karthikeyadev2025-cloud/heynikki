"use client";

import { useEffect } from "react";
import { installAuthDeepLink } from "../lib/native";
import { landingFor } from "../lib/landing";
import { createClient } from "../lib/supabase";

/** In the phone app only: catches the Google sign-in deep link even when
 *  the app was cold-started by it (the WebView then opens on the home
 *  page, not /login). No-op in a browser. */
export default function NativeBridge() {
  useEffect(() => { installAuthDeepLink(() => landingFor(createClient())); }, []);
  return null;
}
