#!/usr/bin/env node
// One-off generator for src/app/favicon.ico (Electronic CPH favicon task,
// 2026-09-08). `favicon.ico` can only be a static image file per Next.js's
// file conventions (unlike icon/apple-icon, it cannot be code-generated at
// request time — see node_modules/next/dist/docs/.../app-icons.md), so this
// script renders the exact same design as src/app/icon.tsx through the same
// ImageResponse/Satori pipeline at each embedded size, then hand-packs the
// resulting PNGs into a standard multi-image ICO container (PNG-compressed
// ICO entries have been supported by all major browsers/OSes since Vista).
// Not part of the app's runtime — run once, commit the output, discard.
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { writeFileSync } from "node:fs";

// Exact source-of-truth values from src/app/icon.tsx (32x32 baseline):
// background #0a0910, color #ab9be0, fontWeight 800, borderRadius 6,
// fontSize 22 — all scaled proportionally to 32px for other sizes.
const BASE = 32;
const BG = "#0a0910";
const FG = "#ab9be0";

function iconElement(px) {
  const scale = px / BASE;
  return createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BG,
        color: FG,
        fontSize: Math.round(22 * scale),
        fontWeight: 800,
        borderRadius: Math.round(6 * scale),
      },
    },
    "E",
  );
}

async function renderPng(px) {
  const res = new ImageResponse(iconElement(px), { width: px, height: px });
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function buildIco(pngsBySize) {
  const sizes = Object.keys(pngsBySize).map(Number).sort((a, b) => a - b);
  const count = sizes.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const dataChunks = [];
  for (const size of sizes) {
    const png = pngsBySize[size];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // data size
    entry.writeUInt32LE(offset, 12); // data offset
    offset += png.length;
    dirEntries.push(entry);
    dataChunks.push(png);
  }

  return Buffer.concat([header, ...dirEntries, ...dataChunks]);
}

const SIZES = [16, 32, 48];
const pngs = {};
for (const size of SIZES) {
  pngs[size] = await renderPng(size);
  console.log(`rendered ${size}x${size}: ${pngs[size].length} bytes`);
}

const ico = buildIco(pngs);
writeFileSync("src/app/favicon.ico", ico);
console.log(`wrote src/app/favicon.ico: ${ico.length} bytes, sizes [${SIZES.join(", ")}]`);
