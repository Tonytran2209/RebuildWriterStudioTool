import { FormEvent, useEffect, useState } from "react"
import CrmScreen, { CrmBrand } from "../crm/Screen"
import { I } from "../crm/ui"
import { verifyEmail, resendVerification, authOptions } from "../lib/db"
import { useI18n } from "../lib/i18n"

type Mode = "login" | "signup" | "forgot" | "reset" | "verify"
interface Props {
  onLogin: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<string>
  onForgotPassword: (email: string) => Promise<string>
  onResetPassword: (accessToken: string, password: string) => Promise<string>
  theme?: "light" | "dark"
}

function getRecoveryToken() {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  return params.get("type") === "recovery" ? params.get("access_token") : null
}

function getVerificationToken() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return params.get("type") === "verification" ? params.get("access_token") : null
}

export default function LoginScreen({ onLogin, onSignUp, onForgotPassword, onResetPassword, theme = "light" }: Props) {
  const { tr } = useI18n()
  const [recoveryToken, setRecoveryToken] = useState(getRecoveryToken)
  const [verificationToken, setVerificationToken] = useState(getVerificationToken)
  const [mode, setMode] = useState<Mode>(() => getRecoveryToken() ? "reset" : getVerificationToken() ? "verify" : "login")
  const [options, setOptions] = useState({ provider: "supabase", allowSignup: true, passwordMin: 8 })
  useEffect(() => { void authOptions().then(setOptions).catch(() => {}) }, [])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirmation, setPasswordConfirmation] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (recoveryToken || verificationToken) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
  }, [recoveryToken, verificationToken])

  const changeMode = (next: Mode) => { setMode(next); setError(null); setMessage(null); setPassword(""); setPasswordConfirmation("") }

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setMessage(null); setLoading(true)
    try {
      if (mode === "login") await onLogin(email, password)
      else if (mode === "signup") setMessage(await onSignUp(email, password))
      else if (mode === "forgot") setMessage(await onForgotPassword(email))
      else if (mode === "verify") {
        if (!verificationToken) throw new Error("Link không hợp lệ.")
        setMessage(await verifyEmail(verificationToken))
        setVerificationToken(null)
        setMode("login")
      }
      else {
        if (!recoveryToken) throw new Error(tr("Link đặt lại mật khẩu đã hết hạn hoặc không hợp lệ.", "The password reset link is expired or invalid."))
        if (password !== passwordConfirmation) throw new Error(tr("Xác nhận mật khẩu chưa khớp.", "Password confirmation does not match."))
        const successMessage = await onResetPassword(recoveryToken, password)
        setRecoveryToken(null)
        setMode("login")
        setPassword("")
        setPasswordConfirmation("")
        setMessage(successMessage)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("Không thể hoàn tất yêu cầu.", "Unable to complete the request."))
    } finally { setLoading(false) }
  }

  const title = mode === "verify" ? tr("Xác nhận email", "Verify email") : mode === "signup" ? tr("Tạo tài khoản", "Create account") : mode === "forgot" ? tr("Đặt lại mật khẩu", "Reset password") : mode === "reset" ? tr("Tạo mật khẩu mới", "Create a new password") : "Writer Studio"
  const description = mode === "signup" ? tr("Tài khoản mới sẽ có quyền User.", "New accounts receive the User role.") : mode === "forgot" ? tr("Chúng tôi sẽ gửi link đặt lại qua email.", "We will email you a reset link.") : mode === "reset" ? tr("Nhập mật khẩu mới cho tài khoản của bạn.", "Enter a new password for your account.") : tr("Đăng nhập để tiếp tục", "Sign in to continue")
  const icon = mode === "signup" ? "user-plus" : mode === "login" ? "login-2" : "key"
  return <CrmScreen theme={theme}><form onSubmit={submit} style={{ display: "contents" }}>
    <CrmBrand title={title} sub={description} />
    {mode !== "reset" && mode !== "verify" && <label className="fl">Email<input className="inp" required autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>}
    {mode !== "forgot" && mode !== "verify" && <label className="fl">{mode === "reset" ? tr("Mật khẩu mới", "New password") : tr("Mật khẩu", "Password")}<input className="inp" required minLength={mode === "login" ? 8 : options.passwordMin} autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" value={password} onChange={event => setPassword(event.target.value)} /></label>}
    {mode === "reset" && <label className="fl">{tr("Xác nhận mật khẩu mới", "Confirm new password")}<input className="inp" required minLength={options.passwordMin} autoComplete="new-password" type="password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} /></label>}
    {mode === "signup" && options.provider === "postgres" && <button type="button" disabled={loading || !email} className="link" style={{ alignSelf: "flex-start" }} onClick={async () => {
      setLoading(true); setError(null)
      try { setMessage(await resendVerification(email)) }
      catch (e) { setError(e instanceof Error ? e.message : "Không thể gửi email.") }
      finally { setLoading(false) }
    }}>{tr("Gửi lại email xác minh", "Resend verification email")}</button>}
    {error && <p role="alert" className="note err" style={{ margin: 0 }}>{error}</p>}
    {message && <p role="status" className="note ok" style={{ margin: 0 }}>{message}</p>}
    <button type="submit" disabled={loading} className="btn primary lg" style={{ width: "100%" }}><I n={loading ? "loader-2" : icon} />{loading ? tr("Đang xử lý…", "Working…") : mode === "verify" ? tr("Xác nhận email", "Verify email") : mode === "signup" ? tr("Đăng ký", "Create account") : mode === "forgot" ? tr("Gửi link đặt lại", "Send reset link") : mode === "reset" ? tr("Lưu mật khẩu mới", "Save new password") : tr("Đăng nhập", "Sign in")}</button>
    {mode !== "reset" && <div className="links">{options.allowSignup && <button type="button" onClick={() => changeMode("signup")} className="link">{tr("Đăng ký", "Create account")}</button>}<button type="button" onClick={() => changeMode("forgot")} className="link">{tr("Quên mật khẩu?", "Forgot password?")}</button>{mode !== "login" && <button type="button" onClick={() => changeMode("login")} className="link" style={{ color: "var(--f3)" }}><I n="arrow-left" />{tr("Đăng nhập", "Sign in")}</button>}</div>}
  </form></CrmScreen>
}
