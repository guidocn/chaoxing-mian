"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api-client";
import { GraduationCap, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        const res = await api.post<{ ok: boolean; message?: string }>("/api/auth/login", {
          email,
          password,
        });
        if (!res.ok) {
          setError(res.message ?? "登录失败");
          return;
        }
      } else {
        const res = await api.post<{ ok: boolean; message?: string }>("/api/auth/register", {
          email,
          password,
          nickname,
          setupCode,
        });
        if (!res.ok) {
          setError(res.message ?? "注册失败");
          return;
        }
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-200 mb-3">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">超星云刷课平台</h1>
          <p className="text-sm text-slate-500 mt-1">多账号并行 · 视频加速 · 自动答题</p>
        </div>

        <Card className="border-slate-200 shadow-xl">
          <CardHeader>
            <CardTitle>{mode === "login" ? "登录" : "注册账号"}</CardTitle>
            <CardDescription>
              {mode === "login" ? "登录后管理你的超星账号" : "首个注册账号自动成为管理员"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {mode === "register" && (
                <div className="space-y-2">
                  <Label htmlFor="nickname">昵称（可选）</Label>
                  <Input
                    id="nickname"
                    placeholder="你的称呼"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="至少 6 位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {mode === "register" && (
                <div className="space-y-2">
                  <Label htmlFor="setupCode">管理员邀请码（可选）</Label>
                  <Input
                    id="setupCode"
                    placeholder="持有邀请码可注册为管理员"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                  />
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {mode === "login" ? "登录" : "注册并登录"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-slate-500">
              {mode === "login" ? (
                <>
                  还没有账号？
                  <button
                    type="button"
                    className="text-blue-600 hover:underline ml-1"
                    onClick={() => {
                      setMode("register");
                      setError("");
                    }}
                  >
                    立即注册
                  </button>
                </>
              ) : (
                <>
                  已有账号？
                  <button
                    type="button"
                    className="text-blue-600 hover:underline ml-1"
                    onClick={() => {
                      setMode("login");
                      setError("");
                    }}
                  >
                    去登录
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-slate-400 mt-6">
          仅供学习交流使用，请遵守学校相关规定
        </p>
      </div>
    </div>
  );
}
