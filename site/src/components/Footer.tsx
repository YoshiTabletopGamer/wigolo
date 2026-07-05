import { asset, FEEDBACK_LINKS } from "@/lib/site";
import styles from "./Footer.module.css";

const COLS: { title: string; links: { label: string; href?: string; ext?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Tools", href: "#tools" },
      { label: "Parity", href: "#parity" },
      { label: "How it works", href: "#how" },
      { label: "Quickstart", href: "#quickstart" },
      { label: "Pricing (free)", href: "#quickstart" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: "https://github.com/KnockOutEZ/wigolo", ext: true },
      { label: "README", href: "https://github.com/KnockOutEZ/wigolo#readme", ext: true },
      { label: "Contributing", href: "https://github.com/KnockOutEZ/wigolo/blob/main/CONTRIBUTING.md", ext: true },
      { label: "Changelog", href: "https://github.com/KnockOutEZ/wigolo/releases", ext: true },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: "https://github.com/KnockOutEZ/wigolo", ext: true },
      { label: "npm", href: "https://www.npmjs.com/package/wigolo", ext: true },
      { label: "Report a bug", href: "https://github.com/KnockOutEZ/wigolo/issues/new?template=bug_report.yml", ext: true },
      { label: "Feedback", href: "#feedback" },
      { label: "@KnockOutEZ", href: "https://github.com/KnockOutEZ", ext: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "License (AGPL-3.0)", href: "https://github.com/KnockOutEZ/wigolo/blob/main/LICENSE", ext: true },
      { label: "Trademark", href: "https://github.com/KnockOutEZ/wigolo/blob/main/TRADEMARK.md", ext: true },
      { label: "Security", href: "https://github.com/KnockOutEZ/wigolo/blob/main/SECURITY.md", ext: true },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "GitHub", href: "https://github.com/KnockOutEZ/wigolo", ext: true },
      { label: "npm", href: "https://www.npmjs.com/package/wigolo", ext: true },
      { label: "Buy a coffee", href: "https://buymeacoffee.com/knockoutez", ext: true },
    ],
  },
];

function ExtArrow() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ display: "inline", marginLeft: 5, verticalAlign: "middle", opacity: 0.5 }}>
      <path d="M3 9L9 3M4 3h5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.cols}>
          {COLS.map((c) => (
            <div key={c.title} className={styles.col}>
              <h4 className={styles.colTitle}>{c.title}</h4>
              <ul className={styles.list}>
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href ?? "#"}
                      className={styles.link}
                      {...(l.ext ? { target: "_blank", rel: "noreferrer" } : {})}
                    >
                      {l.label}
                      {l.ext && <ExtArrow />}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={styles.bottom}>
          <a href="/" className={styles.brand} aria-label="wigolo home">
            <img src={asset("/wigolo/wigolo-icon.png")} alt="" width={26} height={26} />
            <span>wigolo</span>
          </a>
          <div className={styles.bottomRight}>
            <span className={styles.status}>
              <span className={styles.dot} /> All systems local
            </span>
            <span className={styles.copy}>
              public beta · AGPL-3.0 · built by @KnockOutEZ
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
