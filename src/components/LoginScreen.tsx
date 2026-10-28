import { FormEvent, useEffect, useState } from "react"
import { ArrowLeft, KeyRound, LogIn, UserPlus } from "lucide-react"
import BrandMark from "./BrandMark"
import { verifyEmail, resendVerification, authOptions } from "../lib/db"
import { useI18n } from "../lib/i18n"

type Mode = "login" | "signup" | "forgot" | "reset" | "verify"
interface Props {
  onLogin: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<string>
  onForgotPassword: (email: string) => Promise<string>
  onResetPassword: (accessToken: string, password: string) => Promise<string>
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

export default function LoginScreen({ onLogin, onSignUp, onForgotPassword, onResetPassword }: Props) {
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
  return <main className="writer-login flex min-h-dvh items-center justify-center bg-[var(--ui-bg)] p-5 text-[var(--ui-text)]"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-7 shadow-2xl shadow-black/25">
    <div className="mb-7 flex items-center gap-4"><BrandMark className="h-12 w-12" /><div><h1 className="text-lg font-semibold">{title}</h1><p className="text-xs text-[var(--ui-secondary)]">{description}</p></div></div>
    {mode !== "reset" && mode !== "verify" && <label className="mb-4 block text-sm text-[var(--ui-text)]">Email<input required autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-3 text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-focus)]" /></label>}
    {mode !== "forgot" && mode !== "verify" && <label className="mb-5 block text-sm text-[var(--ui-text)]">{mode === "reset" ? tr("Mật khẩu mới", "New password") : tr("Mật khẩu", "Password")}<input required minLength={mode === "login" ? 8 : options.passwordMin} autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-3 text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-focus)]" /></label>}
    {mode === "reset" && <label className="mb-5 block text-sm text-[var(--ui-text)]">{tr("Xác nhận mật khẩu mới", "Confirm new password")}<input required minLength={options.passwordMin} autoComplete="new-password" type="password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-3 text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-focus)]" /></label>}
    {mode === "signup" && options.provider === "postgres" && <button type="button" disabled={loading || !email} className="mb-4 text-xs text-[var(--ui-link)]" onClick={async () => {
      setLoading(true); setError(null)
      try { setMessage(await resendVerification(email)) }
      catch (e) { setError(e instanceof Error ? e.message : "Không thể gửi email.") }
      finally { setLoading(false) }
    }}>{tr("Gửi lại email xác minh", "Resend verification email")}</button>}
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-lg border border-blue-900/70 bg-blue-950/30 px-3 py-2 text-xs text-blue-200">{message}</p>}
    <button type="submit" disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--ui-primary-bg)] text-sm font-medium text-[var(--ui-primary-text)] transition hover:opacity-90 disabled:opacity-60">{mode === "signup" ? <UserPlus className="h-4 w-4" /> : mode === "login" ? <LogIn className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}{loading ? tr("Đang xử lý…", "Working…") : mode === "verify" ? tr("Xác nhận email", "Verify email") : mode === "signup" ? tr("Đăng ký", "Create account") : mode === "forgot" ? tr("Gửi link đặt lại", "Send reset link") : mode === "reset" ? tr("Lưu mật khẩu mới", "Save new password") : tr("Đăng nhập", "Sign in")}</button>
    {mode !== "reset" && <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-[var(--ui-border)] pt-4 text-xs">{options.allowSignup && <button type="button" onClick={() => changeMode("signup")} className="text-[var(--ui-link)] hover:underline">{tr("Đăng ký", "Create account")}</button>}<button type="button" onClick={() => changeMode("forgot")} className="text-[var(--ui-link)] hover:underline">{tr("Quên mật khẩu?", "Forgot password?")}</button>{mode !== "login" && <button type="button" onClick={() => changeMode("login")} className="flex items-center gap-1 text-[var(--ui-secondary)] hover:text-[var(--ui-text)]"><ArrowLeft className="h-3 w-3" />{tr("Đăng nhập", "Sign in")}</button>}</div>}
  </form></main>
}
