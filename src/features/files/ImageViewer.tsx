import { useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const zoom = (next: number) => {
    setFit(false);
    setScale(Math.max(0.1, Math.min(8, next)));
  };
  return (
    <div className="relative flex min-h-0 flex-1 overflow-auto bg-[radial-gradient(var(--border)_0.7px,transparent_0.7px)] bg-size-[14px_14px]">
      <div className="m-auto flex min-h-full min-w-full items-center justify-center p-5">
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={fit ? "max-h-full max-w-full object-contain" : "max-w-none object-contain"}
          style={fit ? undefined : { width: `${scale * 100}%` }}
        />
      </div>
      <div className="sticky right-3 bottom-3 ml-auto mt-auto mb-3 flex h-8 items-center gap-0.5 rounded-lg border bg-background/92 p-0.5 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon-sm" onClick={() => zoom(scale / 1.2)}><Minus /></Button>
        <button className="min-w-12 text-[11px] tabular-nums" onClick={() => { setFit(false); setScale(1); }}>
          {fit ? "适应" : `${Math.round(scale * 100)}%`}
        </button>
        <Button variant="ghost" size="icon-sm" onClick={() => zoom(scale * 1.2)}><Plus /></Button>
        <Button variant="ghost" size="icon-sm" title="适应窗口" onClick={() => setFit(true)}><Maximize2 /></Button>
        <Button variant="ghost" size="icon-sm" title="重置" onClick={() => { setScale(1); setFit(true); }}><RotateCcw /></Button>
      </div>
    </div>
  );
}
