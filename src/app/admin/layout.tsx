"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { MeResponse } from "@/lib/types";
import { Loader2 } from "lucide-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api
      .get<MeResponse>("/api/auth/me")
      .then((res) => {
        if (!res.authenticated) {
          router.replace("/login");
        } else if (res.user.role !== "admin") {
          router.replace("/dashboard");
        } else {
          setOk(true);
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!ok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }
  return children;
}
