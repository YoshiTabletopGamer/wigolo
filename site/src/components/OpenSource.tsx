import { asset } from "@/lib/site";
import styles from "./OpenSource.module.css";

export default function OpenSource() {
  return (
    <section className={styles.section}>
      <video
        className={styles.video}
        poster={asset("/wigolo/wigolo-vs-poster.png")}
        autoPlay
        muted
        loop
        playsInline
      >
        <source src={asset("/wigolo/wigolo-vs.webm")} type="video/webm" />
        <source src={asset("/wigolo/wigolo-vs.mp4")} type="video/mp4" />
      </video>
      <div className={styles.overlay} />
      <div className={`container ${styles.inner}`}>
        <div className={styles.content}>
          <span className={styles.eyebrow}>Open Source</span>
          <h2 className={styles.title}>
            Free, and meant to
            <br />
            stay that way
          </h2>
          <p className={styles.body}>
            wigolo is AGPL-3.0 — free to use, modify, and self-host, including
            inside a company. Maintained, not paywalled. If it saves you a
            metered search bill, a star keeps it sustainable.
          </p>
          <div className={styles.ctas}>
            <a
              href="https://github.com/KnockOutEZ/wigolo"
              className="btn btn-primary"
            >
              ★ Star on GitHub
            </a>
            <a href="#quickstart" className={styles.readMore}>
              Read the docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
