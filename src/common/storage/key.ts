export class Key {
  constructor(public readonly gameId: number, public readonly userId: number) {}

  public static fromWindow() {
    if (window.user && window.game) {
      // A MapGenie "Map profile" (see common/mapgenie/nativeProfiles.ts)
      // gets its own real storage bucket by using its id here instead of
      // the account's - same storage layer, just scoped per active profile
      // instead of always per account.
      const userId = window.user.activeProfileId ?? window.user.id;
      return new Key(window.game.id, userId);
    }
    throw new Error("No user or game in window");
  }

  public static fromWindowGame(gameId: number) {
    if (window.user) {
      return new Key(gameId, window.user.id);
    }
    throw new Error("No user in window");
  }

  public toString() {
    return `game_${this.gameId}::user_${this.userId}`;
  }
}
