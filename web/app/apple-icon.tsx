import { ImageResponse } from "next/og";
import { IconArt } from "@/lib/icon-art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself, so the art fills the square.
export default function AppleIcon() {
  return new ImageResponse(<IconArt size={180} radius={0} pad={0.08} />, size);
}
