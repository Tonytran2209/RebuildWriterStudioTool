import { FormEvent, useState } from "react"
import { LogIn, ShieldCheck, UserRound } from "lucide-react"
import BrandMark from "./BrandMark"
import { useI18n } from "../lib/i18n"

interface Props {
  onLogin: (email: string, password: string) => Promise<void>
}

export default function LoginScreen({ onLogin }: Props) {
  const { tr } = useI18n()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onLogin(email, password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("Không thể đăng nhập.", "Unable to sign in."))
    } finally {
      setLoading(false)
    }
  }

  return <main className="flex min-h-dvh items-center justify-center bg-[#141414] p-5 text-[#e5e5e5]">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[#303030] bg-[#1c1c1c] p-7 shadow-2xl shadow-black/25">
      <div className="mb-7 flex items-center gap-3"><BrandMark /><div><h1 className="text-lg font-semibold">Writer Studio</h1><p className="text-xs text-[#a1a1aa]">{tr("Đăng nhập để tiếp tục", "Sign in to continue")}</p></div></div>
      <label className="mb-4 block text-sm text-[#d4d4d8]">Email<input required autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#3a3a3a] bg-[#252525] px-3 text-white outline-none transition focus:border-blue-500" /></label>
      <label className="mb-5 block text-sm text-[#d4d4d8]">{tr("Mật khẩu", "Password")}<input required autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#3a3a3a] bg-[#252525] px-3 text-white outline-none transition focus:border-blue-500" /></label>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
      <button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"><LogIn className="h-4 w-4" />{loading ? tr("Đang đăng nhập…", "Signing in…") : tr("Đăng nhập", "Sign in")}</button>
      <div className="mt-6 space-y-2 border-t border-[#303030] pt-4 text-xs text-[#a1a1aa]"><p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5" />{tr("User: tạo và quản lý bài viết.", "User: create and manage articles.")}</p><p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-blue-400" />{tr("Admin: thêm quyền quản trị Settings và Knowledge Base.", "Admin: includes Settings and Knowledge Base administration.")}</p></div>
    </form>
  </main>
}
