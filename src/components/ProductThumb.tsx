"use client";
import { useState } from "react";
import { getWbImageUrl } from "@/lib/wb-image";

export default function ProductThumb({ nmId }: { nmId: number }) {
  const [failed, setFailed] = useState(false);
  const url = getWbImageUrl(nmId, "small");
  if (!url || failed)
    return <div className="w-11 h-14 rounded bg-[var(--border)] flex-shrink-0" />;
  return (
    <img
      src={url}
      alt=""
      width={44}
      height={56}
      className="w-11 h-14 rounded object-cover flex-shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
