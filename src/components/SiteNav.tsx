"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const TABS = [
  { href: "/", label: "Teams" },
  { href: "/free-agents", label: "Free Agents" },
  { href: "/watchlist", label: "Watchlist" },
];

export default function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();

  // First-run: if no league is configured yet, send the user to /setup.
  useEffect(() => {
    if (pathname === "/setup") return;
    let cancelled = false;
    void fetch("/api/setup", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: { anyConfigured?: boolean }) => {
        if (!cancelled && !s.anyConfigured) router.replace("/setup");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return (
    <nav className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="flex h-12 items-center gap-1 px-3 sm:px-4">
        <span className="mr-3 text-sm font-bold tracking-tight text-zinc-100">⚾ Fantasy</span>
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
        <Link
          href="/setup"
          className={`ml-auto rounded-md px-3 py-1.5 text-sm font-medium transition ${
            pathname === "/setup" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Setup
        </Link>
      </div>
    </nav>
  );
}
