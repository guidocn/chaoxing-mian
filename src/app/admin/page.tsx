"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api-client";
import type { AdminUserDTO as AdminUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Users, UserCircle, Play, Loader2, MoreHorizontal, Shield, ShieldOff, Ban, Trash2 } from "lucide-react";

export default function AdminHome() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ users: AdminUser[] }>("/api/admin/users");
    setUsers(res.users);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: number, action: "promote" | "demote" | "ban" | "unban" | "delete") {
    setBusyId(id);
    await api.patch(`/api/admin/users/${id}`, { action });
    setBusyId(null);
    load();
  }

  const totalAccounts = users.reduce((s, u) => s + u.accountCount, 0);
  const totalRunning = users.reduce((s, u) => s + u.runningCount, 0);

  const stats = [
    { label: "用户总数", value: users.length, icon: Users, color: "from-blue-500 to-indigo-600" },
    { label: "绑定账号", value: totalAccounts, icon: UserCircle, color: "from-emerald-500 to-teal-600" },
    { label: "运行中任务", value: totalRunning, icon: Play, color: "from-amber-500 to-orange-600" },
    {
      label: "管理员",
      value: users.filter((u) => u.role === "admin").length,
      icon: Shield,
      color: "from-purple-500 to-pink-600",
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">管理后台</h1>
        <p className="text-sm text-slate-500 mt-0.5">管理平台用户与刷课任务</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-500">{s.label}</div>
                <div className="text-2xl font-bold text-slate-800 mt-1">{s.value}</div>
              </div>
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center`}>
                <s.icon className="w-5 h-5 text-white" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">用户管理</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-center">账号数</TableHead>
                <TableHead className="text-center">运行中</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium text-slate-800">{u.nickname || "未命名"}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {u.role === "admin" ? (
                      <Badge className="bg-purple-100 text-purple-700">管理员</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-600">用户</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.status === "banned" ? (
                      <Badge className="bg-red-100 text-red-700">已封禁</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-700">正常</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{u.accountCount}</TableCell>
                  <TableCell className="text-center">{u.runningCount}</TableCell>
                  <TableCell className="text-sm text-slate-500">{u.createdAt.slice(0, 10)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={busyId === u.id}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>用户操作</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {u.role === "admin" ? (
                          <DropdownMenuItem onClick={() => act(u.id, "demote")}>
                            <ShieldOff className="w-4 h-4 mr-2" />
                            取消管理员
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(u.id, "promote")}>
                            <Shield className="w-4 h-4 mr-2" />
                            设为管理员
                          </DropdownMenuItem>
                        )}
                        {u.status === "banned" ? (
                          <DropdownMenuItem onClick={() => act(u.id, "unban")}>
                            <Ban className="w-4 h-4 mr-2" />
                            解封
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(u.id, "ban")} className="text-amber-600">
                            <Ban className="w-4 h-4 mr-2" />
                            封禁
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => act(u.id, "delete")} className="text-red-600">
                          <Trash2 className="w-4 h-4 mr-2" />
                          删除用户
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
