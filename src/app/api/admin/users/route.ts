import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const adminClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  return { supabase, adminClient };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { data: users, error } = await auth.adminClient
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(users || []);
  } catch (error) {
    console.error("Admin users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const body = await request.json();
    const { email, password, fullName, role = "user" } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email dan password wajib diisi" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password minimal 6 karakter" }, { status: 400 });
    }

    const { data: newUser, error: createError } = await auth.adminClient.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: fullName || "" },
      email_confirm: true,
    });

    if (createError) {
      console.error("Create user error:", createError);
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    // Set role if admin
    if (role === "admin" && newUser.user) {
      await auth.adminClient
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", newUser.user.id);
    }

    return NextResponse.json({ success: true, user: newUser.user });
  } catch (error) {
    console.error("Create user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { userId, role, dailyImageLimit } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "User ID wajib diisi" }, { status: 400 });
    }

    const updates: { role?: "user" | "admin"; daily_image_limit?: number } = {};

    if (role !== undefined) {
      if (role !== "user" && role !== "admin") {
        return NextResponse.json({ error: "Role tidak valid" }, { status: 400 });
      }
      updates.role = role;
    }

    if (dailyImageLimit !== undefined) {
      const limit = Number(dailyImageLimit);
      if (!Number.isInteger(limit) || limit < 0 || limit > 500) {
        return NextResponse.json({ error: "Limit tidak valid" }, { status: 400 });
      }
      updates.daily_image_limit = limit;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });
    }

    const { error } = await auth.adminClient
      .from("profiles")
      .update(updates)
      .eq("id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
