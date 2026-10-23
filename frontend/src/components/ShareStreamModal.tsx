"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { VestingStream } from "@/types";
import styles from "./ShareStreamModal.module.css";

interface ShareStreamModalProps {
  stream: VestingStream;
  onClose: () => void;
}

function getShareUrl(recipient: string): string {
  const shareBase = import.meta.env.VITE_SHARE_BASE_URL || import.meta.env.VITE_API_BASE_URL || window.location.origin;
  const shareOrigin = new URL(shareBase, window.location.origin).origin;
  return new URL(`/share/stream/${encodeURIComponent(recipient)}`, shareOrigin).toString();
}

export function ShareStreamModal({ stream, onClose }: ShareStreamModalProps) {
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShareUrl(getShareUrl(stream.recipient));
  }, [stream.recipient]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const shareText = `Vesting stream for ${stream.recipient}`;

  return (
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="share-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>STREAM LINK</p>
            <h2 id="share-title">Share this stream</h2>
          </div>
          <button className={styles.close} type="button" onClick={onClose} aria-label="Close share dialog">
            ×
          </button>
        </header>

        <div className={styles.preview}>
          <div className={styles.previewTop}>
            <span className={styles.previewLabel}>VESTINGSTREAM</span>
            <span className={styles.status}>{stream.status.replaceAll("_", " ")}</span>
          </div>
          <strong className={styles.amount}>
            {stream.claimableAmount.toLocaleString()} <span>{stream.token} claimable</span>
          </strong>
          <dl className={styles.details}>
            <div><dt>Recipient</dt><dd>{stream.recipient}</dd></div>
            <div><dt>Sponsor</dt><dd>{stream.sponsor}</dd></div>
          </dl>
          <p className={styles.readOnly}>Recipients can view the schedule and vesting timeline. Claiming requires the recipient wallet.</p>
        </div>

        <div className={styles.shareRow}>
          <div className={styles.url} title={shareUrl}>{shareUrl}</div>
          <button className={styles.copy} type="button" onClick={copyLink} disabled={!shareUrl}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        <div className={styles.footer}>
          <div className={styles.socials}>
            <a href={`https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: shareUrl })}`} target="_blank" rel="noreferrer">X</a>
            <a href={`https://t.me/share/url?${new URLSearchParams({ url: shareUrl, text: shareText })}`} target="_blank" rel="noreferrer">Telegram</a>
          </div>
          {shareUrl && <QRCodeSVG value={shareUrl} size={88} level="M" title="QR code for this stream" />}
        </div>
      </section>
    </div>
  );
}