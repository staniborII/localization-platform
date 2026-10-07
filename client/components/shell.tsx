/**
 * Page frame: title, short description, and the links between the web client views.
 * The filled tab is the list the user is on, or the list they opened this page from.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { sectionFromPath, type Section } from "@/lib/navigation";
import { cn } from "cn";

const links: { href: `/${Section}`; label: string; section: Section }[] = [
  { href: "/upload", label: "Upload", section: "upload" },
  { href: "/jobs", label: "Jobs", section: "jobs" },
  { href: "/gallery", label: "Gallery", section: "gallery" },
  { href: "/failures", label: "Failures", section: "failures" },
];

/** Links back to the list or job this page was opened from. */
function ReturnLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto w-fit px-0")}>
      {label}
    </Link>
  );
}

/** Renders the heading, the return link, and the filled tab for the current list. */
export function Shell({
  title,
  description,
  section,
  back,
  children,
}: {
  title: string;
  description?: string;
  section?: Section;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = section ?? sectionFromPath(pathname);

  return (
    <>
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-2 gap-y-2 px-6 py-3">
          <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "font-semibold")}>
            Localization
          </Link>
          <nav className="flex flex-wrap gap-1">
            {links.map((link) => {
              const selected = current === link.section;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={buttonVariants({ variant: selected ? "default" : "ghost", size: "sm" })}
                  aria-current={selected ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-1">
          {back ? <ReturnLink href={back.href} label={back.label} /> : null}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </main>
    </>
  );
}
