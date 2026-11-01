// The app icon as an element for next/og's ImageResponse (favicon, Apple and PWA icons).
export const ICON_BG = "#1e3a8a";

/** `pad` shrinks the shield for maskable icons, whose edges get cropped to a circle. */
export function IconArt({ size, pad = 0, radius = 0.22 }: { size: number; pad?: number; radius?: number }) {
  const inner = size * (1 - pad * 2);
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: ICON_BG, borderRadius: size * radius }}>
      <svg width={inner * 0.78} height={inner * 0.78} viewBox="0 0 32 32">
        <path d="M16 3.5 6 7.2v8.1c0 6.4 4.3 11.4 10 13.4 5.7-2 10-7 10-13.4V7.2L16 3.5Z" fill="rgba(255,255,255,0.14)" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round" />
        <path d="m11.6 16 3.2 3.2 6-6.4" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
