import * as Phaser from "phaser";
import { campusFromPath, isWorldPath } from "../../../lib/world/paths";

/**
 * The first scene, and the only one that reads the address bar: it starts
 * the world map for /world, a campus for /campus/<organisation> and an
 * office for everything else, then is never heard from again.
 */
export class EntryScene extends Phaser.Scene {
  constructor() {
    super({ key: "EntryScene" });
  }

  create() {
    const campus = campusFromPath(window.location.pathname);
    if (isWorldPath(window.location.pathname)) {
      this.scene.start("WorldScene", { from: null });
    } else if (campus) {
      this.scene.start("CampusScene", { campus, from: null });
    } else {
      this.scene.start("OfficeScene");
    }
  }
}
