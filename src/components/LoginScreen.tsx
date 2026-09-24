import { FormEvent, useEffect, useState } from "react"
import { ArrowLeft, KeyRound, LogIn, UserPlus } from "lucide-react"
import BrandMark from "./BrandMark"
import { useI18n } from "../lib/i18n"

type Mode = "login" | "signup" | "forgot" | "reset"
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

export default function LoginScreen({ onLogin, onSignUp, onForgotPassword, onResetPassword }: Props) {
  const { tr } = useI18n()
  const [recoveryToken, setRecoveryToken] = useState(getRecoveryToken)
  const [mode, setMode] = useState<Mode>(() => getRecoveryToken() ? "reset" : "login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirmation, setPasswordConfirmation] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (recoveryToken) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
  }, [recoveryToken])

  const changeMode = (next: Mode) => { setMode(next); setError(null); setMessage(null); setPassword(""); setPasswordConfirmation("") }

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setMessage(null); setLoading(true)
    try {
      if (mode === "login") await onLogin(email, password)
      else if (mode === "signup") setMessage(await onSignUp(email, password))
      else if (mode === "forgot") setMessage(await onForgotPassword(email))
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

  const title = mode === "signup" ? tr("Tạo tài khoản", "Create account") : mode === "forgot" ? tr("Đặt lại mật khẩu", "Reset password") : mode === "reset" ? tr("Tạo mật khẩu mới", "Create a new password") : "Writer Studio"
  const description = mode === "signup" ? tr("Tài khoản mới sẽ có quyền User.", "New accounts receive the User role.") : mode === "forgot" ? tr("Chúng tôi sẽ gửi link đặt lại qua email.", "We will email you a reset link.") : mode === "reset" ? tr("Nhập mật khẩu mới cho tài khoản của bạn.", "Enter a new password for your account.") : tr("Đăng nhập để tiếp tục", "Sign in to continue")
  return <main className="flex min-h-dvh items-center justify-center bg-[#141414] p-5 text-[#e5e5e5]"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[#303030] bg-[#1c1c1c] p-7 shadow-2xl shadow-black/25">
    <div className="mb-7 flex items-center gap-4"><BrandMark className="h-12 w-12" /><div><h1 className="text-lg font-semibold">{title}</h1><p className="text-xs text-[#a1a1aa]">{description}</p></div></div>
    {mode !== "reset" && <label className="mb-4 block text-sm text-[#d4d4d8]">Email<input required autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#3a3a3a] bg-[#252525] px-3 text-white outline-none transition focus:border-blue-500" /></label>}
    {mode !== "forgot" && <label className="mb-5 block text-sm text-[#d4d4d8]">{mode === "reset" ? tr("Mật khẩu mới", "New password") : tr("Mật khẩu", "Password")}<input required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#3a3a3a] bg-[#252525] px-3 text-white outline-none transition focus:border-blue-500" /></label>}
    {mode === "reset" && <label className="mb-5 block text-sm text-[#d4d4d8]">{tr("Xác nhận mật khẩu mới", "Confirm new password")}<input required minLength={8} autoComplete="new-password" type="password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#3a3a3a] bg-[#252525] px-3 text-white outline-none transition focus:border-blue-500" /></label>}
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-lg border border-blue-900/70 bg-blue-950/30 px-3 py-2 text-xs text-blue-200">{message}</p>}
    <button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60">{mode === "signup" ? <UserPlus className="h-4 w-4" /> : mode === "login" ? <LogIn className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}{loading ? tr("Đang xử lý…", "Working…") : mode === "signup" ? tr("Đăng ký", "Create account") : mode === "forgot" ? tr("Gửi link đặt lại", "Send reset link") : mode === "reset" ? tr("Lưu mật khẩu mới", "Save new password") : tr("Đăng nhập", "Sign in")}</button>
    {mode !== "reset" && <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-[#303030] pt-4 text-xs"><button type="button" onClick={() => changeMode("signup")} className="text-blue-400 hover:text-blue-300">{tr("Đăng ký", "Create account")}</button><button type="button" onClick={() => changeMode("forgot")} className="text-blue-400 hover:text-blue-300">{tr("Quên mật khẩu?", "Forgot password?")}</button>{mode !== "login" && <button type="button" onClick={() => changeMode("login")} className="flex items-center gap-1 text-[#a1a1aa] hover:text-white"><ArrowLeft className="h-3 w-3" />{tr("Đăng nhập", "Sign in")}</button>}</div>}
  </form></main>
}
