// MapGenie's own "Map profiles" feature (multiple save slots per account,
// managed from the map page header) is gated server-side - unlike the other
// Pro features this extension unlocks, there's no client-side flag to flip,
// since the real POST to create one is rejected by MapGenie's backend with
// a 402 for non-Pro accounts. These helpers back a local-only stand-in: the
// axios interceptor in Client intercepts the create/rename/delete/switch
// calls for profiles created this way instead of forwarding them to
// MapGenie's servers.
//
// This is a cosmetic stand-in, not real multi-profile data tracking: all of
// these local profiles still share the same found-locations/notes data as
// the account's one real profile. They exist so the "Manage Profiles" UI
// works instead of erroring, not to give each one separate progress.

export interface NativeProfile {
  id: number;
  name: string;
}

const storageKey = (gameId: number, userId: number) =>
  `fmg:game_${gameId}:user_${userId}:native-profiles`;

export const getNativeProfiles = (
  gameId: number,
  userId: number
): NativeProfile[] => {
  try {
    const raw = localStorage.getItem(storageKey(gameId, userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveNativeProfiles = (
  gameId: number,
  userId: number,
  profiles: NativeProfile[]
) => {
  localStorage.setItem(storageKey(gameId, userId), JSON.stringify(profiles));
};

export const addNativeProfile = (
  gameId: number,
  userId: number,
  name: string
): NativeProfile => {
  const profiles = getNativeProfiles(gameId, userId);
  // Negative and time-based so it can never collide with a real (positive)
  // MapGenie profile id.
  const profile: NativeProfile = { id: -Date.now(), name };
  saveNativeProfiles(gameId, userId, [...profiles, profile]);
  return profile;
};

export const renameNativeProfile = (
  gameId: number,
  userId: number,
  id: number,
  name: string
): NativeProfile | null => {
  const profiles = getNativeProfiles(gameId, userId);
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) return null;

  const updated = { ...profiles[index], name };
  profiles[index] = updated;
  saveNativeProfiles(gameId, userId, profiles);
  return updated;
};

export const removeNativeProfile = (
  gameId: number,
  userId: number,
  id: number
) => {
  const profiles = getNativeProfiles(gameId, userId).filter(
    (p) => p.id !== id
  );
  saveNativeProfiles(gameId, userId, profiles);
};

export const isNativeProfile = (
  gameId: number,
  userId: number,
  id: number
): boolean => {
  return getNativeProfiles(gameId, userId).some((p) => p.id === id);
};
