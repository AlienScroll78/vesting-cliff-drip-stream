"use client";
import { useEffect } from "react";
import { initAnalytics, analytics } from "@/analytics";

export function AnalyticsInit() {
  useEffect(() => {
    initAnalytics();
    analytics.pageView(typeof window !== "undefined" ? window.location.pathname : "/");
  }, []);

  return null;
}
