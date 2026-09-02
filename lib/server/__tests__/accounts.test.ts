import { beforeEach, describe, expect, it } from "vitest";
import { RoomStore } from "../room-store";
import { personIdForEmail } from "../person-id";

const ROBERT = { email: "Robert@Example.com", name: "Robert C", image: "https://pic/robert" };
const PROFILE = {
  name: "Robert",
  home: "castle-atlantic",
  character: { key: "character_02", path: "/characters/Premade_Character_48x48_02.png" },
};

let store: RoomStore;

beforeEach(() => {
  store = new RoomStore(":memory:");
});

describe("an account", () => {
  it("begins on the first visit, with what the provider said", () => {
    const account = store.visitAccount(ROBERT);
    expect(account.email).toBe("robert@example.com");
    expect(account.displayName).toBe("Robert C");
    expect(account.image).toBe("https://pic/robert");
    expect(account.profile).toBeNull();
    expect(account.visits).toBe(1);
    expect(account.stats).toEqual({});
  });

  it("counts every visit and keeps the profile across them", () => {
    store.visitAccount(ROBERT);
    store.saveAccountProfile(ROBERT, PROFILE);
    const again = store.visitAccount({ ...ROBERT, name: "Rob", image: null });
    expect(again.visits).toBe(2);
    expect(again.displayName).toBe("Rob");
    expect(again.profile).toEqual(PROFILE);
  });

  it("gets a desk in its home building under a stable id", () => {
    const account = store.saveAccountProfile(ROBERT, PROFILE);
    expect(account.personId).toBe(personIdForEmail("robert@example.com"));
    expect(store.listPeople("castle-atlantic")).toEqual([{ id: account.personId, name: "Robert" }]);

    store.saveAccountProfile(ROBERT, { ...PROFILE, home: "sandbox-erp" });
    expect(store.listPeople("castle-atlantic")).toEqual([]);
    expect(store.listPeople("sandbox-erp")).toEqual([{ id: account.personId, name: "Robert" }]);
  });

  it("keeps whatever is counted about it", () => {
    store.visitAccount(ROBERT);
    store.bumpAccountStat(ROBERT.email, "pinball-games");
    const account = store.bumpAccountStat("robert@example.com", "pinball-games", 2);
    expect(account?.stats).toEqual({ "pinball-games": 3 });
    expect(store.bumpAccountStat("nobody@example.com", "x")).toBeNull();
  });
});

describe("a person id from an email", () => {
  it("is the same every time, whatever the case, and looks like a minted one", () => {
    const id = personIdForEmail("Robert@Example.com");
    expect(id).toBe(personIdForEmail("robert@example.com"));
    expect(id).toMatch(/^[a-z0-9]{4,16}$/);
    expect(id).not.toBe(personIdForEmail("other@example.com"));
  });
});
