import { ImageResponse } from "next/og";

// Same design as icon.tsx (the existing desktop favicon), scaled to Apple's
// 180x180 touch-icon size: fontSize/borderRadius scale proportionally with
// the 32px baseline (22 * 180/32, 6 * 180/32) so the E stays centered at
// the same relative size and corner rounding as every other icon size.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0910",
          color: "#ab9be0",
          fontSize: 124,
          fontWeight: 800,
          borderRadius: 34,
        }}
      >
        E
      </div>
    ),
    size,
  );
}
