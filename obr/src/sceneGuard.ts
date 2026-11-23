import OBR from "@owlbear-rodeo/sdk";
import { SCENE_METADATA_KEY } from "../../shared/obr/protocol.ts";

/** A scene transition or GM demotion permanently invalidates an operation, even if the GM returns. */
export function watchScene() {
  let invalid = false;
  let invalidReason = "The Owlbear scene changed. Reconnect, then send again.";
  let sceneId: string | undefined;
  const stopReady = OBR.scene.onReadyChange(() => {
    invalid = true;
  });
  const stopMetadata = OBR.scene.onMetadataChange((metadata) => {
    if (sceneId && readId(metadata) !== sceneId) invalid = true;
  });
  const stopRole =
    typeof OBR.player?.onChange === "function"
      ? OBR.player.onChange((player) => {
          if (player.role !== "GM") {
            invalid = true;
            invalidReason = "You are no longer a GM in this room.";
          }
        })
      : () => {};
  function assertValid() {
    if (invalid) throw new Error(invalidReason);
  }
  return {
    bind(id: string) {
      sceneId = id;
    },
    assertValid,
    async check() {
      assertValid();
      const ready = await OBR.scene.isReady();
      if (!ready) {
        invalid = true;
        assertValid();
      }
      const metadata = await OBR.scene.getMetadata();
      if (sceneId !== undefined && readId(metadata) !== sceneId) invalid = true;
      assertValid();
    },
    dispose() {
      stopReady();
      stopMetadata();
      stopRole();
    },
  };
}

function readId(metadata: Record<string, unknown>): unknown {
  const value = metadata[SCENE_METADATA_KEY];
  return value && typeof value === "object" && "sceneId" in value ? value.sceneId : undefined;
}
