"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import type { MeResponse } from "@/lib/types";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    api
      .get<MeResponse>("/api/auth/me")
      .then((res) => {
        if (res.ok && res.authenticated && res.user) {
          router.replace("/dashboard");
        } else {
          router.replace("/login");
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
    </div>
  );
}
