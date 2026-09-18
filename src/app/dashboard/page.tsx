"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import type { CxAccountDTO as CxAccount } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Play, Square, Trash2, UserCircle, Loader2 } from "lucide-react";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  idle: { text: "空闲", cls: "bg-slate-100 text-slate-600" },
  queued: { text: "排队中", cls: "bg-amber-100 text-amber-700" },
  running: { text: "运行中", cls: "bg-blue-100 text-blue-700" },
  paused: { text: "已暂停", cls: "bg-orange-100 text-orange-700" },
  done: { text: "已完成", cls: "bg-green-100 text-green-700" },
  error: { text: "异常", cls: "bg-red-100 text-red-700" },
};

export default function DashboardHome() {
  const [accounts, setAccounts] = useState<CxAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [speed, setSpeed] = useState("2");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ accounts: CxAccount[] }>("/api/accounts");
    setAccounts(res.accounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function createAccount() {
    if (!phone || !password) {
      setError("请填写手机号和密码");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.post<{ ok: boolean; message?: string }>("/api/accounts", {
        name,
        phone,
        password,
        speed: Number(speed) || 2,
        autoSubmit,
      });
      if (!res.ok) {
        setError(res.message ?? "添加失败");
        return;
      }
      setOpen(false);
      setName("");
      setPhone("");
      setPassword("");
      setSpeed("2");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a: CxAccount) {
    setBusyId(a.id);
    await api.put(`/api/accounts/${a.id}`, { active: a.active ? 0 : 1 });
    await load();
    setBusyId(null);
  }

  async function removeAccount() {
    if (!deleteId) return;
    setBusyId(deleteId);
    await api.del(`/api/accounts/${deleteId}`);
    setDeleteId(null);
    await load();
    setBusyId(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">我的超星账号</h1>
          <p className="text-sm text-slate-500 mt-0.5">添加账号后，系统将自动登录并刷课</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-1.5" />
              添加账号
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加超星账号</DialogTitle>
              <DialogDescription>账号信息仅用于登录超星平台，cookies 独立隔离存储</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>备注名称（可选）</Label>
                <Input placeholder="如：我的主号" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>手机号</Label>
                <Input placeholder="超星登录手机号" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>密码</Label>
                <Input
                  type="password"
                  placeholder="超星登录密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>视频倍速（固定 1x）</Label>
                  <Input type="number" value={1} readOnly disabled className="opacity-60" />
                </div>
                <div className="space-y-2">
                  <Label>测验自动提交</Label>
                  <div className="flex items-center h-9">
                    <Switch checked={autoSubmit} onCheckedChange={setAutoSubmit} />
                  </div>
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={createAccount} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                添加
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      ) : accounts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <UserCircle className="w-12 h-12 text-slate-300 mb-3" />
            <p className="text-slate-500">还没有添加超星账号</p>
            <Button className="mt-4" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              添加第一个账号
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const st = STATUS_LABEL[a.status] ?? STATUS_LABEL.idle;
            const running = a.status === "running";
            return (
              <Card key={a.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold">
                        {(a.name || a.phone).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-slate-800">{a.name || a.phone}</div>
                        <div className="text-xs text-slate-400">{a.phone}</div>
                      </div>
                    </div>
                    <Badge className={st.cls}>{st.text}</Badge>
                  </div>

                  <div className="text-sm text-slate-500 space-y-1 mb-4 min-h-[2.5rem]">
                    <div>课程 {a.totalCourses} · 已完成 {a.completedCourses}</div>
                    {a.lastError && <div className="text-red-500 text-xs truncate">{a.lastError}</div>}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={a.active}
                        disabled={busyId === a.id}
                        onCheckedChange={() => toggleActive(a)}
                      />
                      <span className="text-xs text-slate-500">{a.active ? "已启用" : "已停用"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link href={`/dashboard/accounts/${a.id}`}>
                        <Button variant="outline" size="sm">
                          {running ? <Square className="w-3.5 h-3.5 mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                          管理
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        disabled={busyId === a.id}
                        onClick={() => setDeleteId(a.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除账号？</AlertDialogTitle>
            <AlertDialogDescription>将同时删除该账号的 cookies、课程与任务记录，此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={removeAccount}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
