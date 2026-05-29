import { ImageResponse } from "next/og";

export const alt = "MCP Profiles — programmable identity for AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GREEN = "#5ee29a";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0c0c0c",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 16, height: 16, borderRadius: 999, background: "#ff5f57" }} />
            <div style={{ width: 16, height: 16, borderRadius: 999, background: "#febc2e" }} />
            <div style={{ width: 16, height: 16, borderRadius: 999, background: GREEN }} />
          </div>
          <div style={{ color: "#a1a1a1", fontSize: 26, letterSpacing: -0.5 }}>MCP Profiles</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: GREEN, fontSize: 28, marginBottom: 16 }}>
            What comes after MCP?
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: "#f5f5f5",
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            <span>Reusable identity</span>
            <span>for your agents.</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, color: "#8a8a8a", fontSize: 26 }}>
          <span>same model</span>
          <span style={{ color: GREEN }}>·</span>
          <span>different outcomes</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
