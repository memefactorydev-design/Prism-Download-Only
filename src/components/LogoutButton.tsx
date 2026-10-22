"use client";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={logout}
      className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-foreground/8"
    >
      Log out
    </button>
  );
}
