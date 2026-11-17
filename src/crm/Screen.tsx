import type { ReactNode } from "react"
import "./crm.css"

/** Full-page CRM card (login, loading, load error) outside the signed-in shell. */
export default function CrmScreen({ theme, children }: { theme: "light" | "dark"; children: ReactNode }) {
  return <div className={theme === "dark" ? "codex-dark" : "writer-light"}>
    <div className="crm crm-screen"><div className="crm-auth">{children}</div></div>
  </div>
}

export const CrmBrand = ({ title, sub }: { title: string; sub?: string }) =>
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <span className="ws-logo" style={{ background: "#ff8f2b", color: "#fff", width: 28, height: 28, fontSize: 14, borderRadius: 6 }}>F</span>
    <div><h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h1>{sub && <div style={{ color: "var(--f3)" }}>{sub}</div>}</div>
  </div>
