"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import Link from "next/link";
import { GraduationCap, Loader2 } from "lucide-react";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      toast.error(
        error.message === "User already registered"
          ? "Email sudah terdaftar"
          : error.message
      );
      setLoading(false);
      return;
    }

    toast.success("Registrasi berhasil! Silakan login.");
    router.push("/login");
  };

  return (
    <Card className="border-blue-100 shadow-lg">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
          <GraduationCap className="h-6 w-6 text-blue-600" />
        </div>
        <CardTitle className="text-2xl text-blue-900">Daftar Akun</CardTitle>
        <CardDescription>Buat akun LKOM Generator</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Nama Lengkap</Label>
            <Input
              id="fullName"
              type="text"
              placeholder="Bu Guru / Pak Guru"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="border-blue-200 focus:border-blue-400"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="guru@sekolah.id"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border-blue-200 focus:border-blue-400"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Minimal 6 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="border-blue-200 focus:border-blue-400"
            />
          </div>
          <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Mendaftar...
              </>
            ) : (
              "Daftar"
            )}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          Sudah punya akun?{" "}
          <Link href="/login" className="text-blue-600 hover:underline">
            Masuk
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
