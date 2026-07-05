"use client";

import { useEffect, useState } from "react";
import { asset } from "@/lib/site";
import styles from "./Nav.module.css";

type MenuItem = { title: string; desc?: string; href: string; mono?: boolean };
type Menu = { label: string; items: MenuItem[]; wide?: boolean };

const GH = "https://github.com/KnockOutEZ/wigolo";

const MENUS: Menu[] = [
  {
    label: "Tools",
    wide: true,
    items: [
      { title: "search", mono: true, href: "#tools", desc: "Multi-engine search, rank fusion, ML rerank" },
      { title: "fetch", mono: true, href: "#tools", desc: "Tiered router → clean markdown" },
      { title: "crawl", mono: true, href: "#tools", desc: "BFS / DFS / sitemap multi-page" },
      { title: "extract", mono: true, href: "#tools", desc: "Tables, metadata, JSON-LD, schemas" },
      { title: "cache", mono: true, href: "#tools", desc: "Query everything already seen" },
      { title: "find_similar", mono: true, href: "#tools", desc: "Related pages, 3-way fusion" },
      { title: "research", mono: true, href: "#tools", desc: "Decompose → synthesize a cited brief" },
      { title: "agent", mono: true, href: "#tools", desc: "Autonomous plan → gather → synthesize" },
      { title: "diff", mono: true, href: "#tools", desc: "Track how a page changed over time" },
      { title: "watch", mono: true, href: "#tools", desc: "Scheduled re-checks + webhooks" },
    ],
  },
  {
    label: "Parity",
    items: [
      { title: "Benchmark receipts", href: "#parity", desc: "Shown, not asserted" },
      { title: "Comparison", href: "#parity", desc: "vs Firecrawl, Exa, Tavily" },
      { title: "Run it yourself", href: GH, desc: "One cold query, four tools" },
    ],
  },
  {
    label: "How it works",
    items: [
      { title: "Evidence, not blue links", href: "#how" },
      { title: "Routing on observable signals", href: "#how" },
      { title: "Everything it sees, it keeps", href: "#how" },
    ],
  },
  {
    label: "Docs",
    items: [
      { title: "README", href: `${GH}#readme` },
      { title: "CLI reference", href: GH },
      { title: "Quickstart", href: "#quickstart" },
      { title: "Contributing", href: `${GH}/blob/main/CONTRIBUTING.md` },
    ],
  },
];

function Caret() {
  return (
    <svg className={styles.caret} width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`${styles.nav}${scrolled ? " " + styles.scrolled : ""}`}>
      <div className={styles.inner}>
        <a href="/" className={styles.brand} aria-label="wigolo home">
          <img src={asset("/wigolo/wigolo-icon.png")} alt="" width={28} height={28} />
          <span className={styles.wordmark}>wigolo</span>
        </a>

        <nav className={styles.menu}>
          {MENUS.map((m) => (
            <div key={m.label} className={styles.navItem}>
              <button className={styles.menuItem} aria-haspopup="true">
                {m.label}
                <Caret />
              </button>
              <div className={`${styles.panel}${m.wide ? " " + styles.panelWide : ""}`}>
                <div className={styles.panelGrid}>
                  {m.items.map((it) => (
                    <a
                      key={it.title}
                      href={it.href}
                      className={styles.panelLink}
                      {...(it.href.startsWith("http")
                        ? { target: "_blank", rel: "noreferrer" }
                        : {})}
                    >
                      <span
                        className={`${styles.panelTitle}${it.mono ? " " + styles.panelMono : ""}`}
                      >
                        {it.title}
                      </span>
                      {it.desc && <span className={styles.panelDesc}>{it.desc}</span>}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <a href="#quickstart" className={styles.menuItem}>
            Pricing
          </a>
          <a href="#feedback" className={styles.menuItem}>
            Feedback
          </a>
        </nav>

        <div className={styles.right}>
          <a href={GH} className={styles.gh} aria-label="GitHub">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>Star</span>
          </a>
          <a
            href="https://www.npmjs.com/package/wigolo"
            className={styles.contact}
          >
            npm i wigolo
          </a>
          <a href="#quickstart" className={styles.download}>
            Get started
            <span className={styles.key}>›_</span>
          </a>
        </div>
      </div>
    </header>
  );
}
