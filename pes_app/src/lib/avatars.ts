import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Profile photos.
 *
 * Every account keeps its photo at avatars/<auth uid> in the public avatars
 * bucket; the storage policies confine each person to that one path. The
 * address saved on the profile carries ?v=<time>, so a changed photo is
 * fetched afresh instead of the browser showing the old one it cached.
 */

const MAX_BYTES = 2 * 1024 * 1024;

export type AvatarResult = { ok: true; url: string | null } | { ok: false; error: string };

export async function uploadMyAvatar(uid: string, file: File): Promise<AvatarResult> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Choose an image file (JPG or PNG)." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That image is larger than 2 MB." };
  }
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(uid, file, { upsert: true, contentType: file.type });
  if (uploadError) {
    console.error("[avatars] upload", uploadError);
    return { ok: false, error: "The photo could not be uploaded. Please try again." };
  }
  const { data } = supabase.storage.from("avatars").getPublicUrl(uid);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  const { error } = await supabase.rpc("set_my_avatar", { p_url: url });
  if (error) {
    console.error("[avatars] set_my_avatar", error);
    return { ok: false, error: "The photo uploaded but could not be saved to your profile." };
  }
  forget([uid]);
  return { ok: true, url };
}

export async function removeMyAvatar(uid: string): Promise<AvatarResult> {
  const { error } = await supabase.rpc("set_my_avatar", { p_url: null });
  if (error) {
    console.error("[avatars] clear", error);
    return { ok: false, error: "The photo could not be removed. Please try again." };
  }
  // The file itself is best removed too, but the profile no longer points
  // at it, so a failure here changes nothing anyone sees.
  await supabase.storage.from("avatars").remove([uid]);
  forget([uid]);
  return { ok: true, url: null };
}

/* ---- Looking photos up for the people a page shows ---- */

const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();

function forget(ids: string[]) {
  ids.forEach((id) => cache.delete(id));
  listeners.forEach((l) => l());
}

async function load(ids: string[]) {
  const missing = ids.filter((id) => !cache.has(id));
  if (missing.length === 0) return;
  missing.forEach((id) => cache.set(id, null));
  const { data, error } = await supabase.rpc("get_avatar_urls", { p_ids: missing });
  if (error) {
    console.error("[avatars] get_avatar_urls", error);
    return;
  }
  for (const row of (data ?? []) as { id: string; avatar_url: string }[]) {
    cache.set(row.id, row.avatar_url);
  }
  listeners.forEach((l) => l());
}

/**
 * Photo addresses by id, for any mix of student ids, lecturer ids and
 * lecturer sign-in ids. Looked up once per id and shared across pages; an
 * id with no photo maps to null.
 */
export function useAvatarUrls(ids: (string | null | undefined)[]): Record<string, string | null> {
  const key = ids.filter(Boolean).sort().join(",");
  const [, bump] = useState(0);

  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (key) load(key.split(","));
  }, [key]);

  const out: Record<string, string | null> = {};
  for (const id of key ? key.split(",") : []) out[id] = cache.get(id) ?? null;
  return out;
}
