// MapGenie's own "Map profiles" feature (multiple save slots per account,
// managed from the map page header) is gated server-side - unlike the other
// Pro features this extension unlocks, there's no client-side flag to flip,
// since the real POST to create one is rejected by MapGenie's backend with
// a 402 for non-Pro accounts. The axios interceptor in Client intercepts
// the create/rename/delete/switch calls for profiles created this way
// instead of forwarding them to MapGenie's servers.
//
// Each native profile gets real, separate found-locations/notes/categories
// data: Key.fromWindow() (src/common/storage/key.ts) uses
// window.user.activeProfileId as the storage userId when one is set, so a
// native profile's data lives under its own key in the exact same local +
// cloud storage every other profile already uses - no separate data layer
// needed, just a different id scoping the same one.

export interface NativeProfile {
  id: number;
  name: string;
}

const profilesStorageKey = (gameId: number, userId: number) =>
  `fmg:game_${gameId}:user_${userId}:native-profiles`;

const activeStorageKey = (gameId: number, userId: number) =>
  `fmg:game_${gameId}:user_${userId}:native-active-profile`;

export const getNativeProfiles = (
  gameId: number,
  userId: number
): NativeProfile[] => {
  try {
    const raw = localStorage.getItem(profilesStorageKey(gameId, userId));
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
  localStorage.setItem(
    profilesStorageKey(gameId, userId),
    JSON.stringify(profiles)
  );
};

export const addNativeProfile = (
  gameId: number,
  userId: number,
  name: string
): NativeProfile => {
  const profiles = getNativeProfiles(gameId, userId);
  // Negative and time-based so it can never collide with a real (positive)
  // MapGenie profile id, and can double as this profile's own storage
  // userId (see Key.fromWindow()).
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

  // Deleting the active profile: fall back to the account's default one,
  // same as MapGenie's own UI does before letting you delete it.
  if (getActiveNativeProfileId(gameId, userId) === id) {
    setActiveNativeProfileId(gameId, userId, null);
  }
};

export const isNativeProfile = (
  gameId: number,
  userId: number,
  id: number
): boolean => {
  return getNativeProfiles(gameId, userId).some((p) => p.id === id);
};

// Which native profile is active, persisted so it survives a reload - the
// real MapGenie account never actually learns about these profiles, so its
// own "active profile" bootstrap field always reports the default one.
export const getActiveNativeProfileId = (
  gameId: number,
  userId: number
): number | null => {
  try {
    const raw = localStorage.getItem(activeStorageKey(gameId, userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const setActiveNativeProfileId = (
  gameId: number,
  userId: number,
  id: number | null
) => {
  if (id === null) {
    localStorage.removeItem(activeStorageKey(gameId, userId));
  } else {
    localStorage.setItem(activeStorageKey(gameId, userId), JSON.stringify(id));
  }
};
