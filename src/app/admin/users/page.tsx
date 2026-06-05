"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Shield, User, GraduationCap, Plus, Loader2 } from "lucide-react";
import type { Profile } from "@/types";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";
import { toast } from "sonner";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    fullName: "",
    role: "user" as "user" | "admin",
  });

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(fetchUsers);
  }, [fetchUsers]);

  const handleCreateUser = async () => {
    if (!newUser.email || !newUser.password) {
      toast.error("Email dan password wajib diisi");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(`User ${newUser.email} berhasil dibuat`);
        setCreateOpen(false);
        setNewUser({ email: "", password: "", fullName: "", role: "user" });
        fetchUsers();
      } else {
        toast.error(data.error || "Gagal membuat user");
      }
    } catch {
      toast.error("Gagal membuat user");
    }
    setCreating(false);
  };

  const toggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Gagal mengubah role");
      return;
    }
    fetchUsers();
  };

  const updateLimit = async (userId: string, limit: number) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, dailyImageLimit: limit }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Gagal mengubah limit");
      return;
    }
    fetchUsers();
  };

  const filteredUsers = users.filter(
    (u) =>
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-blue-900">Kelola Users</h1>
            <p className="text-sm text-muted-foreground">Kelola akun guru dan pengajar</p>
          </div>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
              <Plus className="h-4 w-4" />
              Tambah User
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Tambah User Baru</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nama Lengkap</Label>
                  <Input
                    value={newUser.fullName}
                    onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                    placeholder="Bu Guru / Pak Guru"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="guru@sekolah.id"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Minimal 6 karakter"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as "user" | "admin" })}
                    className="w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="user">Guru (User)</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button
                  onClick={handleCreateUser}
                  disabled={creating}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {creating ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Membuat...</>
                  ) : (
                    "Buat User"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="border-blue-100 mb-4">
          <CardContent className="pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari user berdasarkan nama atau email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 border-blue-200"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-100">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {filteredUsers.length} user ditemukan
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-blue-50" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Limit/Hari</TableHead>
                    <TableHead>Bergabung</TableHead>
                    <TableHead>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                            <User className="h-4 w-4 text-blue-600" />
                          </div>
                          <div>
                            <div className="font-medium">{user.full_name || "Tanpa Nama"}</div>
                            <div className="text-xs text-muted-foreground">{user.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.role === "admin" ? "default" : "secondary"}
                          className={user.role === "admin" ? "bg-blue-600" : ""}
                        >
                          {user.role === "admin" ? (
                            <><Shield className="mr-1 h-3 w-3" /> Admin</>
                          ) : (
                            <><GraduationCap className="mr-1 h-3 w-3" /> Guru</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <select
                          value={user.daily_image_limit}
                          onChange={(e) => updateLimit(user.id, parseInt(e.target.value))}
                          className="rounded border border-blue-200 bg-white px-2 py-1 text-sm"
                        >
                          <option value={5}>5</option>
                          <option value={10}>10</option>
                          <option value={15}>15</option>
                          <option value={20}>20</option>
                          <option value={30}>30</option>
                          <option value={50}>50</option>
                        </select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(user.created_at), {
                          addSuffix: true,
                          locale: id,
                        })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-blue-200 text-xs"
                          onClick={() => toggleRole(user.id, user.role)}
                        >
                          {user.role === "admin" ? "Jadikan User" : "Jadikan Admin"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
