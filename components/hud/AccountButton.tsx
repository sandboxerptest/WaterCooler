"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useMe } from "@/lib/account-client";
import { clearProfile } from "@/lib/profile";

/**
 * Who is signed in, and the way out. Shows nothing for a guest, or before
 * the server has answered. Signing out forgets the profile mirrored into
 * this browser first, so the next person at this keyboard starts afresh.
 */
export default function AccountButton() {
  const me = useMe();
  const account = me?.account;
  if (!account) return null;

  const label = account.profile?.name ?? account.displayName ?? account.email;
  const leave = () => {
    clearProfile();
    void signOut({ redirectTo: "/" });
  };

  return (
    <button
      type="button"
      className="topbar-tool-btn topbar-account"
      onClick={leave}
      title={`Signed in as ${account.email} — sign out`}
      aria-label={`Signed in as ${account.email}. Sign out`}
    >
      {account.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a provider's avatar, any host
        <img src={account.image} alt="" width={20} height={20} className="topbar-account__image" />
      ) : (
        <span className="topbar-account__initial">{label.slice(0, 1).toUpperCase()}</span>
      )}
      <LogOut size={12} aria-hidden />
    </button>
  );
}
