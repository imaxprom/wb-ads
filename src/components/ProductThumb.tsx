"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWbImageCandidateUrls, withImageVersion } from "@/lib/wb-image";

function withRetryVersion(url: string, retryRound: number): string {
  if (!url || retryRound <= 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}retry=${retryRound}`;
}

export default function ProductThumb({ nmId, version }: { nmId: number; version?: string | null }) {
  const [urlIdx, setUrlIdx] = useState(0);
  const [retryRound, setRetryRound] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urls = useMemo(() => {
    return getWbImageCandidateUrls(nmId, "medium")
      .map((url) => withImageVersion(url, version))
      .map((url) => withRetryVersion(url, retryRound));
  }, [nmId, version, retryRound]);
  const url = urls[urlIdx] || "";

  useEffect(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    setRetryRound(0);
    setUrlIdx(0);
  }, [nmId, version]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  function handleError() {
    setUrlIdx((idx) => {
      const nextIdx = idx + 1;
      if (nextIdx < urls.length) return nextIdx;
      if (!retryTimerRef.current && retryRound < 3) {
        const delayMs = [3000, 10000, 30000][retryRound] ?? 30000;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setRetryRound((round) => round + 1);
          setUrlIdx(0);
        }, delayMs);
      }
      return nextIdx;
    });
  }

  if (!url)
    return <div className="w-11 h-14 rounded bg-[var(--border)] flex-shrink-0" />;
  return (
    <img
      src={url}
      alt=""
      width={44}
      height={56}
      className="w-11 h-14 rounded object-cover flex-shrink-0"
      onError={handleError}
    />
  );
}
