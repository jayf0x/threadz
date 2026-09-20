import { useEffect, useRef } from "react";
import { setLevelSink } from "@/lib/voice/engine";

// Newest sample lands in the middle bar and ripples outward — reads as a voice
// waveform with five <i>s. Updates are written to the DOM directly (see .vu in
// styles.css); this component never re-renders while audio is flowing.
const CENTER_OUT = [2, 1, 3, 0, 4];

export const VoiceMeter = () => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const bars = Array.from(root.children) as HTMLElement[];
    const history = new Array<number>(bars.length).fill(0);
    setLevelSink((level, speaking) => {
      history.pop();
      history.unshift(level);
      for (let i = 0; i < history.length; i++)
        bars[CENTER_OUT[i]].style.transform = `scaleY(${0.18 + history[i] * 0.82})`;
      root.dataset.speaking = String(speaking);
    });
    return () => setLevelSink(null);
  }, []);

  return (
    <span ref={ref} className="vu" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
};
