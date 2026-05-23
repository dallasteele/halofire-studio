import { useGame } from "./store";

export function HUD() {
  const home = useGame((s) => s.scoreHome);
  const away = useGame((s) => s.scoreAway);
  const quarter = useGame((s) => s.quarter);
  const clock = useGame((s) => s.clock);
  const banner = useGame((s) => s.banner);
  const bannerUntil = useGame((s) => s.bannerUntil);
  const mins = Math.floor(clock / 60);
  const secs = Math.ceil(clock) % 60;
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 10,
          padding: "12px 24px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 24,
          alignItems: "center",
          color: "#fff",
          fontVariantNumeric: "tabular-nums",
          minWidth: 360,
          textAlign: "center",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <div>
          <div style={{ color: "#ff8b8b", fontSize: 13, letterSpacing: 1 }}>HOME</div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>{home}</div>
        </div>
        <div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Q{quarter}</div>
          <div style={{ fontSize: 22 }}>
            {mins}:{secs.toString().padStart(2, "0")}
          </div>
        </div>
        <div>
          <div style={{ color: "#8baaff", fontSize: 13, letterSpacing: 1 }}>AWAY</div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>{away}</div>
        </div>
      </div>
      {banner && bannerUntil > 0 && (
        <div
          style={{
            position: "absolute",
            top: "40%",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 60,
            fontWeight: 800,
            color: "#ffd84a",
            textShadow: "0 4px 30px rgba(0,0,0,0.7)",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {banner}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 12,
          color: "rgba(255,255,255,0.75)",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        WASD move • Shift sprint • E pickup • Hold LMB to charge shot • RMB pass • Tab switch player • MMB drag camera
      </div>
    </>
  );
}
