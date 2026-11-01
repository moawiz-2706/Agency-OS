import { ImageResponse } from "next/og";
import { IconArt } from "@/lib/icon-art";

// PWA icons: /icons/192, /icons/512 and /icons/maskable (512, with safe padding).
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }, { size: "maskable" }];
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = size === "192" ? 192 : 512;
  const art = size === "maskable" ? <IconArt size={px} radius={0} pad={0.12} /> : <IconArt size={px} />;
  return new ImageResponse(art, { width: px, height: px });
}
