"use client";

export const runtime = "edge";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { CxAccountDTO as CxAccount, CourseDTO as CourseRow, LogDTO as TaskLog, TaskDTO as TaskRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Play,
  Pause,
  RotateCcw,
  KeyRound,
  Loader2,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  idle: { text: "空闲", cls: "bg-slate-100 text-slate-600" },
  queued: { text: "排队中", cls: "bg-amber-100 text-amber-700" },
  running: { text: "运行中", cls: "bg-blue-100 text-blue-700" },
  paused: { text: "已暂停", cls: "bg-orange-100 text-orange-700" },
  done: { text: "已完成", cls: "bg-green-100 text-green-700" },
  error: { text: "异常", cls: "bg-red-100 text-red-700" },
};

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  const [account, setAccount] = useState<CxAccount | null>(null);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [loginOpen, setLoginOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [speed, setSpeed] = useState("2");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [loginError, setLoginError] = useState("");
  const logBoxRef = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {
    const [accRes, courseRes] = await Promise.all([
      api.get<{ account: CxAccount; task: TaskRow | null; logs?: TaskLog[] }>(
        `/api/accounts/${accountId}/task`,
      ),
      api.get<{ courses: CourseRow[] }>(`/api/accounts/${accountId}/courses`),
    ]);
    setAccount(accRes.account ?? null);
    setTask(accRes.task ?? null);
    setCourses(courseRes.courses ?? []);
    setLogs(accRes.logs ?? []);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 3000);
    return () => clearInterval(t);
  }, [loadAll]);

  // Cloudflare 无后台常驻进程：任务运行时由浏览器定时驱动引擎 tick
  const tickingRef = useRef(false);
  useEffect(() => {
    if (task?.status !== "running") return;
    let timer: ReturnType<typeof setTimeout>;
    const drive = async () => {
      if (tickingRef.current) {
        timer = setTimeout(drive, 1500);
        return;
      }
      tickingRef.current = true;
      try {
        await api.post(`/api/accounts/${accountId}/task/tick`, {});
      } catch {
        // 忽略单次失败，下轮重试
      } finally {
        tickingRef.current = false;
        await loadAll();
        timer = setTimeout(drive, 1200);
      }
    };
    timer = setTimeout(drive, 500);
    return () => clearTimeout(timer);
  }, [task?.status, accountId, loadAll]);

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  async function doLogin() {
    setBusy(true);
    setLoginError("");
    try {
      const res = await api.post<{ ok: boolean; message?: string }>(
        `/api/accounts/${accountId}/login`,
        { phone, password }
      );
      if (!res.ok) {
        setLoginError(res.message ?? "登录失败");
        return;
      }
      setLoginOpen(false);
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function fetchCourses() {
    setBusy(true);
    const res = await api.post<{ ok: boolean; message?: string }>(
      `/api/accounts/${accountId}/courses`,
      {}
    );
    setBusy(false);
    if (!res.ok) alert(res.message ?? "获取课程失败");
    await loadAll();
  }

  async function toggleCourse(courseId: string, active: boolean) {
    await api.put(`/api/accounts/${accountId}/courses/${courseId}`, { active: active ? 1 : 0 });
    await loadAll();
  }

  async function updateSettings() {
    await api.put(`/api/accounts/${accountId}`, {
      speed: Number(speed) || 2,
      autoSubmit: autoSubmit ? 1 : 0,
    });
  }

  async function taskAction(action: "start" | "pause" | "reset") {
    setBusy(true);
    await api.post(`/api/accounts/${accountId}/task/control`, { action });
    setBusy(false);
    setTimeout(loadAll, 500);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!account) {
    return <div className="text-center py-20 text-slate-500">账号不存在</div>;
  }

  const st = STATUS_LABEL[task?.status ?? "idle"] ?? STATUS_LABEL.idle;
  const running = task?.status === "running";
  const progress =
    task && task.totalPoints > 0
      ? Math.round(((task.donePoints + task.failedPoints) / task.totalPoints) * 100)
      : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              {account.name || account.phone}
              <Badge className={st.cls}>{st.text}</Badge>
            </h1>
            <p className="text-sm text-slate-500">{account.phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={account.cookiesValid ? "default" : "secondary"} className={account.cookiesValid ? "bg-green-100 text-green-700" : ""}>
            {account.cookiesValid ? "登录有效" : "未登录"}
          </Badge>
          {!loginOpen && (
            <Button variant="outline" size="sm" onClick={() => { setPhone(account.phone); setLoginOpen(true); }}>
              <KeyRound className="w-4 h-4 mr-1" />
              重新登录
            </Button>
          )}
        </div>
      </div>

      {loginOpen && (
        <Card className="mb-6 border-blue-200 bg-blue-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">登录超星</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>手机号</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>密码</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            {loginError && <p className="text-sm text-red-600 mt-3">{loginError}</p>}
            <div className="flex gap-2 mt-4">
              <Button onClick={doLogin} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                登录
              </Button>
              <Button variant="ghost" onClick={() => setLoginOpen(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* 任务控制 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">刷课任务</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <Button onClick={() => taskAction("start")} disabled={busy || running} className="bg-green-600 hover:bg-green-700">
                  <Play className="w-4 h-4 mr-1.5" />
                  开始
                </Button>
                <Button onClick={() => taskAction("pause")} disabled={busy || !running} variant="outline">
                  <Pause className="w-4 h-4 mr-1.5" />
                  暂停
                </Button>
                <Button onClick={() => taskAction("reset")} disabled={busy} variant="outline">
                  <RotateCcw className="w-4 h-4 mr-1.5" />
                  重置
                </Button>
                <span className="text-sm text-slate-500">
                  当前课程：{task?.currentCourse || "—"}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">总进度</span>
                  <span className="text-slate-800 font-medium">
                    {task ? `${task.donePoints + task.failedPoints}/${task.totalPoints}` : "0/0"} 任务点
                    {task && task.totalPoints > 0 ? ` · ${progress}%` : ""}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
                <div className="flex gap-4 text-xs text-slate-500 pt-1">
                  <span className="text-green-600">完成 {task?.donePoints ?? 0}</span>
                  <span className="text-red-500">失败 {task?.failedPoints ?? 0}</span>
                  <span>跳过 {task?.skippedPoints ?? 0}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 课程列表 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">课程选择</CardTitle>
                <Button variant="outline" size="sm" onClick={fetchCourses} disabled={busy}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  拉取课程
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {courses.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">
                  暂无课程，请先登录后点击「拉取课程」
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {courses.map((c) => (
                    <div
                      key={c.courseId}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:bg-slate-50"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="text-sm font-medium text-slate-800 truncate">{c.title}</div>
                        <div className="text-xs text-slate-400">
                          {c.teacher ? `${c.teacher}` : "超星课程"}
                        </div>
                      </div>
                      <Switch
                        checked={c.selected}
                        onCheckedChange={(v) => toggleCourse(c.courseId, v)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* 刷课参数 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">刷课参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>视频倍速（1-16）</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="1"
                  max="16"
                  defaultValue={account.speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  onBlur={updateSettings}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>测验自动提交</Label>
                <Switch
                  defaultChecked={account.autoSubmit}
                  onCheckedChange={(v) => {
                    setAutoSubmit(v);
                    setTimeout(updateSettings, 0);
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* 实时日志 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">运行日志</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                ref={logBoxRef}
                className="h-72 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed"
              >
                {logs.length === 0 ? (
                  <div className="text-slate-500">暂无日志</div>
                ) : (
                  logs.map((l) => (
                    <div
                      key={l.id}
                      className={
                        l.level === "error"
                          ? "text-red-400"
                          : l.level === "success"
                          ? "text-green-400"
                          : l.level === "warn"
                          ? "text-amber-400"
                          : "text-slate-300"
                      }
                    >
                      <span className="text-slate-500">{l.createdAt.slice(11, 19)}</span>{" "}
                      {l.message}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
