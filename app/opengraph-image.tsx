import { ImageResponse } from "next/og";

/**
 * Root opengraph-image: a code-generated 1200x630 brand card.
 *
 * Sites without an og:image fall back to whatever hero crawl finds — for us
 * that is an AVIF Google treats inconsistently in previews — so the card is
 * drawn instead of shipped: the payload is the route itself, cached by Next
 * and referenced by every page that does not define its own image route.
 *
 * Satori renders with a strict flex layout and the system font stack, which
 * keeps this readable and CI-safe (no font fetch, no asset reads).
 */

export const alt = "Resultapp.org — Automate Your School's Results";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 84px",
          backgroundImage:
            "linear-gradient(135deg, #2E1065 0%, #5B21B6 52%, #9333EA 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* ambient depth */}
        <div
          style={{
            position: "absolute",
            width: 460,
            height: 460,
            borderRadius: 9999,
            backgroundColor: "rgba(255,255,255,0.06)",
            left: -120,
            top: -140,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 340,
            height: 340,
            borderRadius: 9999,
            backgroundColor: "rgba(228,63,255,0.12)",
            right: -80,
            bottom: -110,
            display: "flex",
          }}
        />

        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <span style={{ fontSize: 104, fontWeight: 700, letterSpacing: -4 }}>
            Resultapp
          </span>
          <span style={{ fontSize: 104, fontWeight: 400, opacity: 0.65 }}>
            .org
          </span>
        </div>

        {/* value line */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.25 }}>
            {"Automate your school's results"}
          </span>
          <span
            style={{
              fontSize: 30,
              opacity: 0.82,
              lineHeight: 1.4,
              marginTop: 14,
            }}
          >
            Automated grading · digital report cards · custom school portals ·
            pay-per-student billing
          </span>
        </div>

        {/* domain pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 28px",
            borderRadius: 9999,
            border: "1px solid rgba(255,255,255,0.35)",
            fontSize: 26,
            opacity: 0.9,
          }}
        >
          resultapp.org
        </div>
      </div>
    ),
    { ...size }
  );
}
